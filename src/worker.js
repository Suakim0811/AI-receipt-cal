const OCR_URL = "https://fai0ptxrnz.apigw.ntruss.com/custom/v1/56549/638eafc0223c59619d01bcd45f5e14bd9e67d33dcf0b2ecb6a3524b61bc6f296/general";
const CLOVA_URL = "https://clovastudio.stream.ntruss.com/v1/openai/chat/completions";

function base64FromArrayBuffer(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function stripCodeFence(text) {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

async function readJsonResponse(response, label) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(`${label} 응답이 비어 있습니다.`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 응답이 JSON 형식이 아닙니다.`);
  }
}

function htmlResponse() {
  return null;
}

async function analyzeReceipt(request, env) {
  if (!env.OCR_SECRET_KEY || !env.CLOVA_API_KEY) {
    return Response.json(
      {
        error:
          "Missing secrets. Set OCR_SECRET_KEY and CLOVA_API_KEY in your Cloudflare Worker.",
      },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("image");

  if (!(file instanceof File)) {
    return Response.json({ error: "이미지 파일을 업로드해주세요." }, { status: 400 });
  }

  const imageData = base64FromArrayBuffer(await file.arrayBuffer());
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";

  const ocrPayload = {
    version: "V2",
    requestId: crypto.randomUUID(),
    timestamp: Date.now(),
    images: [
      {
        format: ext === "png" ? "png" : "jpg",
        name: "receipt",
        data: imageData,
      },
    ],
  };

  const ocrResponse = await fetch(OCR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OCR-SECRET": env.OCR_SECRET_KEY,
    },
    body: JSON.stringify(ocrPayload),
  });

  if (!ocrResponse.ok) {
    const errorText = await ocrResponse.text();
    return Response.json(
      { error: "OCR 요청 실패", detail: errorText },
      { status: 502 }
    );
  }

  const ocrResult = await readJsonResponse(ocrResponse, "OCR");
  const fieldList = ocrResult?.images?.[0]?.fields ?? [];

  const fields = fieldList
    .map((field) => {
      const vertices = field?.boundingPoly?.vertices ?? [];

      if (!vertices.length) {
        return null;
      }

      const x = vertices.reduce((sum, vertex) => sum + (vertex.x ?? 0), 0) / vertices.length;
      const y = vertices.reduce((sum, vertex) => sum + (vertex.y ?? 0), 0) / vertices.length;

      return {
        text: field.inferText ?? "",
        x,
        y,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.y - right.y || left.x - right.x);

  const rowThreshold = 6;
  const rows = [];

  for (const field of fields) {
    if (!rows.length) {
      rows.push([field]);
      continue;
    }

    const lastRow = rows[rows.length - 1];
    const lastY = lastRow.reduce((sum, item) => sum + item.y, 0) / lastRow.length;

    if (Math.abs(field.y - lastY) <= rowThreshold) {
      lastRow.push(field);
    } else {
      rows.push([field]);
    }
  }

  for (const row of rows) {
    row.sort((left, right) => left.x - right.x);
  }

  const prompt = `
다음은 OCR로 추출한 영수증 데이터입니다.

${JSON.stringify(rows, null, 2)}

당신은 영수증 분석 전문가입니다.

다음 규칙을 반드시 지켜주세요.

1. 상품명과 최종 결제 가격만 추출합니다.
2. 수량, 단가, 바코드, 상품코드, 회원번호, 승인번호는 제외합니다.
3. 판매총액, 부가세, 카드결제 등은 제외합니다.
4. 가격은 반드시 정수(int)로 출력합니다.
5. 결과는 JSON 배열만 출력합니다.
6. 설명, 코드블록 형식의 문장은 절대 출력하지 않습니다.

출력 예시

[
  {
    "name": "사과",
    "price": 1500
  },
  {
    "name": "오이",
    "price": 850
  }
]
`;

  const llmResponse = await fetch(CLOVA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CLOVA_API_KEY}`,
    },
    body: JSON.stringify({
      model: "HCX-005",
      messages: [
        {
          role: "system",
          content:
            "당신은 영수증 분석 전문가입니다. OCR 결과에서 상품명과 가격만 추출하여 JSON 배열만 출력하세요.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0,
    }),
  });

  if (!llmResponse.ok) {
    const errorText = await llmResponse.text();
    return Response.json(
      { error: "LLM 요청 실패", detail: errorText },
      { status: 502 }
    );
  }

  const llmResult = await readJsonResponse(llmResponse, "LLM");
  const rawText = llmResult?.choices?.[0]?.message?.content ?? "[]";
  const cleanedText = stripCodeFence(rawText);

  let items;

  try {
    items = JSON.parse(cleanedText);
  } catch {
    return Response.json(
      {
        error: "JSON 파싱 실패",
        rawText,
      },
      { status: 502 }
    );
  }

  return Response.json({ items });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/analyze" && request.method === "POST") {
      return analyzeReceipt(request, env);
    }

    if (env.ASSETS) {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return env.ASSETS.fetch(request);
      }

      return env.ASSETS.fetch(request);
    }

    return new Response("Assets binding missing. Serve public/index.html with Wrangler.", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=UTF-8",
      },
    });
  },
};