# from tools.tavily import tavily_search
# from tools.flight import search_flights
# from backend import run_travel_agent
# from tools.wiki import get_place_image

# # res = tavily_search("Adolf Hitler")
# # print(res)
# # # print(res[1])

# # res = search_flights("Plan a 7 days Japan trip from Kolkata")
# # print(res)
# useri = input("Enter travel request: ")
# response = run_travel_agent(
#     user_input = useri,
#     thread_id = "test_user"
# )
# print(response["answer"])
# # from tools.wiki import get_images

# # places = [
# #     "kanchanjunga",
# #     "Mim Tea Garden",
# #     "Namthing Pokhri",
# #     "Ahaldhara View Point"
# # ]

# # images = get_images(places)

# # for img in images:
# #     print(img)

import asyncio
from mcp_client_test import get_all_tools,tavily_mcp_search

if __name__ == "__main__":
    asyncio.run(tavily_mcp_search("adolf hitler"))