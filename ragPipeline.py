#!pip install -q langchain langchain-openai tiktoken chromadb
import langchain
import os
os.environ['OPENAI_API_KEY'] = 'your api key'

#Text Split(문서를 작은 청크로 나누는 것)
from langchain.text_splitter import RecursiveCharacterTextSplitter

#Recursive로 텍스트를 나누기 때문에 문장의 끝부분(마침표같은것)이 온전히 마무리 됨
text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)

splits=text_splitter.split_documents(docs)

print(len(splits))
print(splits[0])

#page_content 속성 - 데이터 뽑아보기
splits[4].page_content

# metadata 속성 -  데이터 뽑아보기 그냥 변수 뒤에 .붙이고 해당 컬럼?명 붙이면 뽑힘
splits[10].metadata

