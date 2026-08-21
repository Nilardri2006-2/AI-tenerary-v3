import os
import certifi
from dotenv import load_dotenv
from typing import TypedDict, Annotated
import operator
import uuid
import time
import json
import re

import psycopg
from psycopg.rows import dict_row

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.postgres import PostgresSaver
from langchain_core.messages import (
    AnyMessage,
    HumanMessage,
    AIMessage,
    SystemMessage,
)
from langchain_cohere import ChatCohere
from tools.tavily import tavily_search
from tools.flight import search_flights
from pydantic import BaseModel, Field
from tools.wiki import get_images
from mcp_client import tavily_mcp_search, extract_destination, forecast_mcp_search, weather_mcp_search
import asyncio

load_dotenv()

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()


def get_database_url():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL is missing.")
    if "sslmode=" not in database_url:
        separator = "&" if "?" in database_url else "?"
        database_url = f"{database_url}{separator}sslmode=require"
    return database_url


COHERE_API_KEY = os.getenv("COHERE_API_KEY")
if not COHERE_API_KEY:
    raise ValueError("COHERE_API_KEY is missing.")


# =========================
# Helpers
# =========================

def extract_text(content) -> str:
    """Extract plain string from Cohere's list-of-dicts content format.

    FIX: Cohere can return extra block types in the content list besides
    the actual answer -- most commonly 'reasoning' blocks (internal
    chain-of-thought). Those blocks don't have a top-level 'text' key, so
    previously they fell through to str(item) and dumped the raw dict
    (with 'type', 'id', 'summary', etc.) straight into user-facing output.
    We now skip any non-'text' block types and only keep the real answer.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                item_type = item.get("type")
                if item_type is not None and item_type != "text":
                    continue
                text = item.get("text")
                if text:
                    parts.append(text)
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return str(content)


def extract_mcp_text(raw) -> str:
    """Extract plain text from MCP tool response format."""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list):
        parts = []
        for item in raw:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
        return "\n".join(parts) if parts else str(raw)
    if isinstance(raw, dict):
        if raw.get("type") == "text":
            return raw.get("text", str(raw))
    return str(raw)


def format_weather(raw) -> str:
    text = extract_mcp_text(raw)
    try:
        data = json.loads(text)
        city = data.get("city", "")
        if "temperature_c" in data:
            return (
                f"📍 {city}\n"
                f"🌡️ Temperature: {data['temperature_c']}°C "
                f"(feels like {data['feels_like_c']}°C)\n"
                f"☁️ Condition: {data['condition'].title()}\n"
                f"💧 Humidity: {data['humidity']}%\n"
                f"💨 Wind Speed: {data['wind_speed']} m/s"
            )
        if "forecast" in data:
            lines = [f"📅 Forecast for {city}:"]
            for entry in data["forecast"]:
                lines.append(
                    f"  • {entry['datetime']} — "
                    f"{entry['temperature']}°C, {entry['weather'].title()}"
                )
            return "\n".join(lines)
    except (json.JSONDecodeError, TypeError):
        pass
    return text


def format_hotel_results(raw) -> str:
    text = extract_mcp_text(raw)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            results = data.get("results", [])
            if results:
                lines = []
                for r in results[:5]:
                    title   = r.get("title", "")
                    content = r.get("content", "")
                    url     = r.get("url", "")
                    lines.append(f"### {title}\n{content}\n🔗 {url}")
                return "\n\n".join(lines)
    except (json.JSONDecodeError, TypeError):
        pass
    return text


# =========================
# LLM
# =========================
# FIX: max_tokens was previously unset, so Cohere fell back to a low
# default and truncated long outputs (this is why your final travel guide
# was cutting off mid-sentence, e.g. "...New Gitanjali"). Set explicitly.

llm = ChatCohere(
    api_key=COHERE_API_KEY,
    temperature=0.4,
    model="command-a-plus-05-2026",
    max_tokens=4096,
)


# =========================
# Models
# =========================

class PlacesResponse(BaseModel):
    places: list[str] = Field(
        description=(
            "Unique list of all tourist attractions, landmarks, viewpoints, "
            "restaurants, museums, parks, shopping areas, beaches, temples, "
            "and other places mentioned in the itinerary."
        )
    )


# =========================
# State
# =========================

class TravelState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    user_query: str
    weather_results: str
    flight_results: str
    hotel_results: str
    itinerary: str
    route: str
    places: list[str]
    images: list[dict]
    llm_calls: Annotated[int, operator.add]


# =========================
# Weather Agent
# =========================

def weather_agent(state: TravelState):
    try:
        city = extract_destination(state["user_query"])
        loop = asyncio.get_event_loop()
        raw_weather  = loop.run_until_complete(weather_mcp_search(city))
        raw_forecast = loop.run_until_complete(forecast_mcp_search(city))
        current  = format_weather(raw_weather)
        forecast = format_weather(raw_forecast)
        weather_text = f"## Current Weather\n{current}\n\n## Forecast\n{forecast}"
    except Exception as e:
        print(f"⚠️ Weather agent failed: {e}")
        weather_text = "Weather data temporarily unavailable."

    return {
        "weather_results": weather_text,
        "messages": [AIMessage(content="Weather information fetched.")],
    }


# =========================
# Flight Agent
# =========================

def flight_agent(state: TravelState):
    query = state["user_query"]
    flight_data = search_flights(query)
    return {
        "flight_results": extract_text(flight_data) if flight_data else "",
        "messages": [AIMessage(content="Flight results fetched.")],
        "llm_calls": 1,
    }


# =========================
# Places Extraction (manual — see note in itinerary_agent)
# =========================

def extract_places_from_itinerary(itinerary: str) -> list[str]:
    """Ask the LLM for a plain JSON array of places and parse it manually.

    FIX: We deliberately avoid llm.with_structured_output() here. Its
    automatic validation-retry mechanism appends the previous error message
    onto the next prompt when the model returns a borderline-invalid item
    (e.g. a food adjective like "Goan" picked up from "Goan fish curry" and
    mistaken for a place). The model then tries to "fix" it by
    second-guessing every other food-adjacent word, and each retry grows
    the error string further, compounding until parsing fails outright
    (OUTPUT_PARSING_FAILURE). Doing the JSON parsing ourselves, with a
    simple regex fallback, avoids that retry spiral entirely.
    """
    prompt = f"""
Extract every unique physical PLACE mentioned in this itinerary,
attractions, landmarks, restaurants, beaches, temples, markets,
viewpoints, museums, parks, or neighborhoods.

Do NOT include food dishes, drinks, cuisines, or regional adjectives
(for example "Goan", "Indian", "local", "Bengali") as standalone
entries, those describe food, not places.

Respond with ONLY a raw JSON array of strings. No markdown, no code
fences, no explanation.
Example: ["Baga Beach", "Fort Aguada", "Anjuna Market"]

Itinerary:
{itinerary}
"""
    try:
        response = llm.invoke(prompt)
        text = extract_text(response.content).strip()
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
        places = json.loads(text)
        if isinstance(places, list):
            cleaned = [p.strip() for p in places if isinstance(p, str) and p.strip()]
            if cleaned:
                return cleaned
    except Exception as e:
        print(f"⚠️ Places JSON parse failed, falling back to regex: {e}")

    skip_words = {"goan", "indian", "local", "bengali", "day", "morning",
                  "afternoon", "evening", "note", "tip", "budget"}
    candidates = re.findall(r"\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b", itinerary)
    seen, fallback = set(), []
    for c in candidates:
        if c not in seen and c.lower() not in skip_words:
            seen.add(c)
            fallback.append(c)
    return fallback[:25]


# =========================
# Itinerary Agent
# =========================

def itinerary_agent(state: TravelState):
    time.sleep(20)
    prompt = f"""
Create a complete travel itinerary.

User Query:
{state['user_query']}

Flight Results:
{state['flight_results']}

Instructions:
- Generate a detailed day-wise itinerary.
- Include only the most popular, iconic, and highly recommended attractions.
- Prioritize must-visit places.
- For each attraction include its name, short description, why it is famous,
  recommended visit duration, and best visiting time.
- Suggest nearby local food specialties and famous restaurants.
- Organize the itinerary logically.
"""
    response1 = llm.invoke(prompt)
    itinerary = extract_text(response1.content)

    places = extract_places_from_itinerary(itinerary)
    print(places)

    return {
        "itinerary": itinerary,
        "places": places,
        "messages": [AIMessage(content=itinerary)],
        "llm_calls": 2,
    }


# =========================
# Transport Agent
# =========================

def mtrn_agent(state: TravelState):
    prompt = f"""
You are an experienced local travel guide.

User Request:
{state["user_query"]}

Itinerary:
{state["itinerary"]}

Places to Visit:
{state["places"]}

Your task is to create the most practical transportation plan for the entire trip.

1. Begin by recommending the best transportation option from the user's source
   location to the main destination (prefer train when practical).

2. After reaching the destination, recommend the best local transport for every
   major travel leg (walking, metro, bus, taxi, rideshare, train, ferry, etc.)

For each leg include:
- From → To
- Recommended transport mode
- Why it is the best choice
- Approximate travel duration
- Approximate travel cost (if available)
- Important notes
"""
    route_plan = llm.invoke(prompt)

    return {
        "route": extract_text(route_plan.content),
        "messages": [AIMessage(content="Transport plan generated.")],
        "llm_calls": 1,
    }


# =========================
# Hotel Agent
# =========================

def hotel_agent(state: TravelState):
    prompt = f"""
You are an expert travel planner.
Analyze the following trip information and determine the BEST places to stay.

User Request: {state["user_query"]}
Itinerary: {state["itinerary"]}
Places to Visit: {state["places"]}
Transportation Plan: {state["route"]}

Return ONLY the hotel search locations under 300 characters.
Example:
Darjeeling (3 nights)
Kalimpong (2 nights)
"""
    summary = llm.invoke(prompt)
    summary_text = extract_text(summary.content)
    hotel_query = f"Best hotels in:\n{summary_text}"

    try:
        loop = asyncio.get_event_loop()
        raw = loop.run_until_complete(tavily_mcp_search(hotel_query))
        hotel_results = format_hotel_results(raw)
    except Exception as e:
        print(f"⚠️ Hotel search failed: {e}")
        hotel_results = f"Hotel search unavailable. Suggested areas:\n{summary_text}"

    return {
        "hotel_results": hotel_results,
        "messages": [AIMessage(content="Hotel locations generated.")],
        "llm_calls": 1,
    }


# =========================
# Final Agent
# =========================

def final_agent(state: TravelState):
    final_prompt = f"""
You are a professional AI travel planner.
Generate a complete, well-structured travel guide.

User Request: {state["user_query"]}
Flight Information: {state["flight_results"]}
Hotel Information: {state["hotel_results"]}
Travel Itinerary: {state["itinerary"]}
Must-Visit Places: {state["places"]}
Transportation Plan: {state["route"]}
Weather: {state["weather_results"]}

Sections:
## Trip Overview
## Weather Information
## Getting There
## Transportation During the Trip
## Hotel Recommendations
## Day-wise Itinerary
## Estimated Budget
## Travel Tips

Use Markdown. Be professional and practical.
"""
    response = llm.invoke([
        SystemMessage(content="You are a professional AI travel booking assistant."),
        HumanMessage(content=final_prompt)
    ])

    result_text = extract_text(response.content)

    return {
        "messages": [AIMessage(content=result_text)],  # ✅ must be AIMessage not string
        "llm_calls": 1,
    }


# =========================
# Image Agent
# =========================

def image_agent(state: TravelState):
    images = get_images(state["places"])
    return {
        "images": images,
        "messages": [AIMessage(content="Images fetched.")],
    }


# =========================
# Build Graph
# =========================

graph = StateGraph(TravelState)

graph.add_node("weather_agent",   weather_agent)
graph.add_node("flight_agent",    flight_agent)
graph.add_node("itinerary_agent", itinerary_agent)
graph.add_node("mtrn_agent",      mtrn_agent)
graph.add_node("hotel_agent",     hotel_agent)
graph.add_node("final_agent",     final_agent)
graph.add_node("image_agent",     image_agent)

graph.add_edge(START,             "weather_agent")
graph.add_edge(START,             "flight_agent")
graph.add_edge("weather_agent",   "final_agent")
graph.add_edge("flight_agent",    "itinerary_agent")
graph.add_edge("itinerary_agent", "image_agent")
graph.add_edge("itinerary_agent", "mtrn_agent")
graph.add_edge("mtrn_agent",      "hotel_agent")
graph.add_edge("image_agent",     "final_agent")
graph.add_edge("hotel_agent",     "final_agent")
graph.add_edge("final_agent",     END)


# =========================
# PostgreSQL Checkpointer
# =========================

DATABASE_URL = get_database_url()

_conn = psycopg.connect(
    DATABASE_URL,
    autocommit=True,
    row_factory=dict_row
)

checkpointer = PostgresSaver(_conn)
checkpointer.setup()

travel_graph = graph.compile(checkpointer=checkpointer)


# =========================
# Function for FastAPI
# =========================

def run_travel_agent(user_input: str, thread_id: str | None = None):
    if not thread_id:
        thread_id = f"user_{uuid.uuid4().hex}"

    config = {"configurable": {"thread_id": thread_id}}

    result = travel_graph.invoke(
        {
            "messages":        [HumanMessage(content=user_input)],
            "user_query":      user_input,
            "weather_results": "",
            "flight_results":  "",
            "hotel_results":   "",
            "itinerary":       "",
            "route":           "",
            "places":          [],
            "images":          [],
            "llm_calls":       0,
        },
        config=config,
    )

    print("IMAGES FROM RESULT:", result.get("images", []))

    return {
        "thread_id":       thread_id,
        "answer":          extract_text(result["messages"][-1].content),
        "weather_results": extract_text(result.get("weather_results", "")),
        "flight_results":  extract_text(result.get("flight_results",  "")),
        "hotel_results":   extract_text(result.get("hotel_results",   "")),
        "itinerary":       extract_text(result.get("itinerary",       "")),
        "images":          result.get("images",    []),
        "llm_calls":       result.get("llm_calls", 0),
    }
