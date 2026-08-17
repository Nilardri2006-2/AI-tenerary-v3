import os
import certifi

from dotenv import load_dotenv
from langchain_mcp_adapters.client import MultiServerMCPClient


# SSL certificates
os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

# Load environment variables
load_dotenv()

tavily_api_key = os.getenv("TAVILY_API_KEY")

if not tavily_api_key:
    raise ValueError("TAVILY_API_KEY is not set")


# MCP Client
client = MultiServerMCPClient(
    {
        "tavily": {
            "transport": "streamable_http",
            "url": f"https://mcp.tavily.com/mcp/?tavilyApiKey={tavily_api_key}",
        }
    }
)


# Cache the tool
tavily_search_tool = None


async def get_all_tools():
    tools = await client.get_tools()

    print("Available tools:")

    for tool in tools:
        print(tool.name)

    return tools


async def get_tavily_search_tool():
    global tavily_search_tool

    # Reuse already loaded tool
    if tavily_search_tool is not None:
        return tavily_search_tool

    tools = await client.get_tools()

    tavily_search_tool = next(
        (tool for tool in tools if tool.name == "tavily_search"),
        None
    )

    if tavily_search_tool is None:
        raise RuntimeError("tavily_search tool not found")

    return tavily_search_tool


async def tavily_mcp_search(query: str):
    tool = await get_tavily_search_tool()

    result = await tool.ainvoke(
        {
            "query": query
        }
    )

    return result