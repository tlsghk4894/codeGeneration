!pip install -q langchain langchain-openai tiktoken chromadb

import langchain
langchain.__version__

import os
os.environ['OPENAI_API_KEY'] = 'OPENAI_API_KEY'

#Load Data
#Data Loader - 웹페이지 데이터 가져오기
from langchain_community.document_loaders import WebBaseLoader

url = 'https://ko.wikipedia.org/wiki/%EC%9C%84%ED%82%A4%EB%B0%B1%EA%B3%BC:%EC%A0%95%EC%B1%85%EA%B3%BC_%EC%A7%80%EC%B9%A8'
loader = WebBaseLoader(url)

#웹페이지 텍스트 -> Documents
docs = loader.load()

print(len(docs))
print(len(docs[0].page_content))
print(docs[0])
