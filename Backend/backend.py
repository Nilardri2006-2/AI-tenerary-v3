import os 
import certifi
from dotenv import load_dotenv
from typing import TypedDict, Annotated
import operator
import uuid
import time
import json
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
from langchain_groq import ChatGroq
from tools.tavily import tavily_search
from tools.flight import search_flights
from pydantic import BaseModel, Field
from tools.wiki import get_images
from mcp_client import tavily_mcp_search,extract_destination,forecast_mcp_search,weather_mcp_search
import asyncio

load_dotenv()

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()


# for using datatbase remote server
def get_database_url():
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        raise ValueError(
            "DATABASE_URL is missing. Please add your Render PostgreSQL External Database URL to .env"
        )

    if "sslmode=" not in database_url:
        separator = "&" if "?" in database_url else "?"
        database_url = f"{database_url}{separator}sslmode=require"

    return database_url


GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY is missing. Please add it to your .env file.")



 
# =========================
# Helpers
# =========================
 
def extract_mcp_text(raw) -> str:
    """
    MCP tools return a list like:
    [{'type': 'text', 'text': '{"city": ...}', 'id': '...'}]
 
    This extracts the plain text string from that structure.
    Works whether raw is a list, dict, or already a string.
    """
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
    """
    Parse the MCP weather JSON and return a clean human-readable string.
    """
    text = extract_mcp_text(raw)
    try:
        data = json.loads(text)
        city = data.get("city", "")
 
        # Current weather format
        if "temperature_c" in data:
            return (
                f"📍 {city}\n"
                f"🌡️ Temperature: {data['temperature_c']}°C "
                f"(feels like {data['feels_like_c']}°C)\n"
                f"☁️ Condition: {data['condition'].title()}\n"
                f"💧 Humidity: {data['humidity']}%\n"
                f"💨 Wind Speed: {data['wind_speed']} m/s"
            )
 
        # Forecast format
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
 
    return text  # fallback: return raw text if JSON parse fails
 
 
def format_hotel_results(raw) -> str:
    """
    Tavily MCP returns a complex object.
    Extract readable text content from it.
    """
    text = extract_mcp_text(raw)
 
    # If it's JSON try to extract result snippets
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            results = data.get("results", [])
            if results:
                lines = []
                for r in results[:5]:  # top 5 results
                    title = r.get("title", "")
                    content = r.get("content", "")
                    url = r.get("url", "")
                    lines.append(f"### {title}\n{content}\n🔗 {url}")
                return "\n\n".join(lines)
    except (json.JSONDecodeError, TypeError):
        pass
 
    return text  # fallback
 
 
# =========================
# LLM
# =========================

llm = ChatGroq(
    api_key=GROQ_API_KEY,
    temperature=0.4,
    model="openai/gpt-oss-120b",
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
    weather_results:str
    flight_results: str
    hotel_results: str
    itinerary: str
    route:str
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
 
        raw_weather   = loop.run_until_complete(weather_mcp_search(city))
        raw_forecast  = loop.run_until_complete(forecast_mcp_search(city))
 
        current  = format_weather(raw_weather)
        forecast = format_weather(raw_forecast)
 
        weather_text = f"## Current Weather\n{current}\n\n## Forecast\n{forecast}"
 
    except Exception as e:
        print(f"Weather data temporarily unavailable. Sorry for the inconvenience: {e}")
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
        "flight_results": flight_data,
        "messages": [
            AIMessage(content="Flight results fetched.")
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }
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
- For each attraction include its name, short description, why it is famous, recommended visit duration, and best visiting time.
- Suggest nearby local food specialties and famous restaurants.
- Organize the itinerary logically.
"""

    response1 = llm.invoke(prompt)

    itinerary = response1.content

    structured_llm = llm.with_structured_output(PlacesResponse)

    response2 = structured_llm.invoke(f"""
Extract every unique place mentioned in this itinerary.

Itinerary:

{itinerary}
""")
    print(response2.places)

    return {
        "itinerary": itinerary,
        "places": response2.places,
        "messages": [AIMessage(content=itinerary)],
        "llm_calls": 2,
    }

# =========================
# Multimodal Transportation Agent
# =========================

def mtrn_agent(state: TravelState):
    query = f"""
You are an experienced local travel guide.

User Request:
{state["user_query"]}

Itinerary:
{state["itinerary"]}

Places to Visit:
{state["places"]}

Your task is to create the most practical transportation plan for the entire trip.

1. Begin by recommending the best transportation option from the user's source location to the main destination (prefer train whenever it is a practical and available option; otherwise recommend the most suitable alternative such as flight, bus, ferry, or taxi).

2. After reaching the destination, recommend the best transportation for every major travel leg and for local sightseeing using the most practical mode available (walking, metro, bus, taxi, rideshare, train, ferry, rental car, etc.).

For each recommendation, include:
- From → To
- Recommended transport mode
- Why it is the best choice
- Approximate travel duration
- Approximate travel cost (if available)
- Important notes (transfers, scenic routes, traffic, timings, etc.)

Optimize the route to minimize travel time while maximizing the sightseeing experience. Use realistic and reliable transportation options based on current travel practices."""
    route_plan  = llm.invoke(query)

    return {
        "route": route_plan .content,
        "messages": [
            AIMessage(content="Multimodal transportation options fetched.")
        ],
        "llm_calls": 1
    }



# =========================
# Hotel Agent
# =========================

from langchain_core.messages import AIMessage


def hotel_agent(state: TravelState):

    prompt = f"""
You are an expert travel planner.
Analyze the following trip information and determine the BEST places to stay.
User Request:
{state["user_query"]}
Itinerary:
{state["itinerary"]}
Places to Visit:
{state["places"]}
Transportation Plan:
{state["route"]}

Your task:
1. Understand the user's travel duration, budget and travel style.
2. Minimize unnecessary travel.
3. Decide the ideal town/city/area to stay for each part of the trip.
4. If multiple hotel locations are needed, mention them in order.
5. Keep the response concise.
Return ONLY the hotel search locations.
reply should be under 300 characters strictly.
Example:
Darjeeling (3 nights)
Kalimpong (2 nights)
or
Times Square, New York (5 nights)
"""

    summary = llm.invoke(prompt)

    hotel_query = f"""
    Best hotels in:
    {summary.content}
"""
    try:
        loop = asyncio.get_event_loop()
        raw = loop.run_until_complete(tavily_mcp_search(hotel_query))
        hotel_results = format_hotel_results(raw)
    except Exception as e:
        print(f"Hotel search unavailable: {e}")
        hotel_results = f"Hotel search unavailable. Suggested areas:\n{summary.content}"
    return {
        "hotel_results": hotel_results,
        "messages": [
            AIMessage(content="Recommended hotel locations generated.")
        ],
        "llm_calls": 1
    }


# =========================
# Final Response Agent
# =========================

def final_agent(state: TravelState):
    final_prompt = f"""
You are a professional AI travel planner.
Generate a complete, well-structured travel guide for the following trip.

User Request:{state["user_query"]}
Flight Information:{state["flight_results"]}
Hotel Information:{state["hotel_results"]}
Travel Itinerary:{state["itinerary"]}
Must-Visit Places:{state["places"]}
Transportation Plan:{state["route"]}
Weather:{state["weather_results"]}

Create a polished travel plan using the following sections:

## Trip Overview
- Destination
- Weather
- Duration
- Best time to visit
- Brief overview of the trip
##  Getting There
Start by explaining how the traveler can reach the destination from their source location.
Mention all practical transportation options (flight, train, bus, ferry, etc.), highlighting the recommended option along with approximate duration and cost.
## Weather Information
##  Transportation During the Trip
Explain how to travel between destinations and attractions according to the transportation plan.
For each travel leg, mention:
- From → To
- Recommended transport
- Duration
- Approximate cost
- Useful travel tips
##  Hotel Recommendations
Recommend the hotels found for the suggested stay locations.
Briefly explain why each location is convenient for the itinerary.
##  Day-wise Itinerary
Present the itinerary in chronological order.
For every day include:
- Places to visit
- Activities
- Food recommendations
- Approximate timings
- Travel suggestions where applicable
##  Estimated Budget
Provide an approximate budget breakdown:
- Transportation
- Accommodation
- Food
- Attractions
- Miscellaneous
- Total estimated cost
##  Travel Tips
Include practical advice such as:
- Best transport passes (if applicable)
- Local etiquette
- Safety tips
- Things to avoid
- Useful apps or recommendations
Important:
- Make the response feel like a professional travel guide.
- Naturally integrate the transportation plan instead of simply listing it.
- Mention that flight information is based on live flight status and ticket prices may not be available.
- Transportation routes are recommendations and may vary depending on real-time traffic, schedules, and local conditions.
- Use Markdown formatting with headings, bullet points, and tables where appropriate.
"""
    response = llm.invoke([
        SystemMessage(content="You are a professional AI travel booking assistant."),
        HumanMessage(content=final_prompt)
    ])

    return {
        "messages": [response],
        "llm_calls":  1
    }




# =========================
# Images
# =========================
def image_agent(state: TravelState):
    images = get_images(state["places"])

    return {
        "images": images,
        "messages": [
            AIMessage(content="Images fetched.")
        ]
    }
# =========================
# Build Graph
# =========================

graph = StateGraph(TravelState)

graph.add_node("flight_agent", flight_agent)
graph.add_node("itinerary_agent", itinerary_agent)
graph.add_node("mtrn_agent", mtrn_agent)
graph.add_node("hotel_agent", hotel_agent)
graph.add_node("final_agent", final_agent)
graph.add_node("image_agent", image_agent)
graph.add_node("weather_agent", weather_agent)


graph.add_edge(START, "weather_agent")
graph.add_edge(START, "flight_agent")
graph.add_edge("weather_agent", "final_agent")
graph.add_edge("flight_agent", "itinerary_agent")
graph.add_edge("itinerary_agent", "image_agent")
graph.add_edge("itinerary_agent", "mtrn_agent")
graph.add_edge("mtrn_agent", "hotel_agent")
graph.add_edge("image_agent", "final_agent")
graph.add_edge("hotel_agent", "final_agent")
graph.add_edge("final_agent", END)


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

    config = {
        "configurable": {
            "thread_id": thread_id
        }
    }

    result = travel_graph.invoke(
        {
            "messages": [HumanMessage(content=user_input)],
            "user_query": user_input,
            "weather_results":"",
            "flight_results": "",
            "hotel_results": "",
            "itinerary": "",
            "route": "",
            "places": [],
            "images":[],
            "llm_calls": 0,
        },
        config=config,
    )

    final_answer = result["messages"][-1].content
    print("IMAGES FROM RESULT:", result.get("images", []))

    return {
        "thread_id": thread_id,
        "answer": final_answer,
        "weather_results": result.get("weather_results", ""),
        "flight_results": result.get("flight_results", ""),
        "hotel_results": result.get("hotel_results", ""),
        "itinerary": result.get("itinerary", ""),
        "images": result.get("images", []),
        "llm_calls": result.get("llm_calls", 0),
    }
