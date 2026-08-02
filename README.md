# AI-receipt-cal
OCR-LLM 혼용 더치페이 계산기  
Cloudflare Workers 전용

---
# 주요 파일

|파일 이름|역할|
|---|---|
|worker.js|백엔드; 이미지 입력, OCR, LLM 호출 등을 담당|
|app.js|프론트엔드; 사이트의 외적인 기능(버튼 클릭 이벤트 처리 등), 계산기 로직을 포함함|
|index.html|프론트엔드; 사이트 구조|

## worker.js
OCR이 이미지에서 텍스트 추출 -> 텍스트를 LLM에 넘겨 필요 없는 텍스트는 쳐내고 상품-가격 뱉도록 함 -> 계산
### 1. 이미지 업로드 처리
```
	const formData = await request.formData();
	const file = formData.get("image");
```
▲ `formData`로 이미지를 받음  
```
	const imageData = base64FromArrayBuffer(await file.arrayBuffer());
	const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
```
▲ 이미지를 base64 문자열로 변환
### 2. CLOVA OCR API 호출
```
  const ocrResponse = await fetch(OCR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OCR-SECRET": env.OCR_SECRET_KEY,
    },
    body: JSON.stringify(ocrPayload),
  });
```
▲ OCR_URL로 이미지 전송
```
  const ocrResult = await readJsonResponse(ocrResponse, "OCR");
  const fieldList = ocrResult?.images?.[0]?.fields ?? [];
  ...(생략)
```
▲ 응답을 받아 이후 텍스트 가공  
원시 응답에는 예측의 신뢰도, 타입 등 필요하지 않은 정보들이 함께 날아옴  
따라서 텍스트 가공 과정은 텍스트만 추출하여 위치에 따라 정렬하는 역할을 함

### 3. HYPERCLOVA X(LLM) 호출
```
const llmResponse = await fetch(CLOVA_URL, {
    ...
});
```
▲ LLM 호출
---

