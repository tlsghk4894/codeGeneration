# 텍스트를 임베딩하여 Store에 저장하는 단계
# 벡터 스토어는 Chroma db
# 임베딩은 OpenAI
from langchain_community.vectorstores import Chroma
from langchain_openai import OpenAIEmbeddings
vectorstore = Chroma.from_documents(documents=splits,
                                    embedding=OpenAIEmbeddings())

docs = vectorstore.similarity_search("격하 과정에 대해서 설명해주세요.")
print(len(docs))
print(docs[0].page_content)
