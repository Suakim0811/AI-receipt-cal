const receiptInput = document.getElementById("receipt");
const peopleInput = document.getElementById("people");
const analyzeButton = document.getElementById("analyze");
const resetButton = document.getElementById("reset");
const preview = document.getElementById("preview");
const statusNode = document.getElementById("status");
const resultsNode = document.getElementById("results");
const summaryNode = document.getElementById("summary");
const summaryText = document.getElementById("summaryText");
const itemTemplate = document.getElementById("item-template");

let items = [];
let selections = [];

function setStatus(message) {
  statusNode.textContent = message;
}

function parsePeople() {
  return peopleInput.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function renderPreview(file) {
  if (!file) {
    preview.innerHTML = '<div class="placeholder">이미지를 선택하면 미리보기가 표시됩니다.</div>';
    return;
  }

  const url = URL.createObjectURL(file);
  preview.innerHTML = `<img alt="receipt preview" src="${url}" />`;
}

function renderItems() {
  resultsNode.innerHTML = "";
  summaryNode.hidden = true;

  if (!items.length) {
    resultsNode.innerHTML = '<div class="placeholder">아직 분석된 품목이 없습니다.</div>';
    return;
  }

  const people = parsePeople();
  selections = items.map(() => new Set());

  items.forEach((item, index) => {
    const card = itemTemplate.content.cloneNode(true);
    const article = card.querySelector(".result-card");
    const title = card.querySelector(".result-title");
    const price = card.querySelector(".price");
    const peopleWrap = card.querySelector(".people");
    const selectAll = card.querySelector(".select-all");
    const selectNone = card.querySelector(".select-none");

    title.textContent = item.name;
    price.textContent = `${Number(item.price).toLocaleString()}원`;

    const inputs = people.map((person) => {
      const label = document.createElement("label");
      label.className = "person-chip";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = false;

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selections[index].add(person);
        } else {
          selections[index].delete(person);
        }
      });

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(person));

      return label;
    });

    selectAll.addEventListener("click", () => {
      selections[index].clear();
      inputs.forEach((label) => {
        const checkbox = label.querySelector("input");
        checkbox.checked = true;
        selections[index].add(label.textContent.trim());
      });
    });

    selectNone.addEventListener("click", () => {
      selections[index].clear();
      inputs.forEach((label) => {
        label.querySelector("input").checked = false;
      });
    });

    inputs.forEach((node) => peopleWrap.appendChild(node));
    resultsNode.appendChild(article);
  });

  const calcButton = document.createElement("button");
  calcButton.className = "primary";
  calcButton.type = "button";
  calcButton.textContent = "계산하기";
  calcButton.style.marginTop = "10px";

  calcButton.addEventListener("click", () => {
    const people = parsePeople();
    const totals = Object.fromEntries(people.map((person) => [person, 0]));

    items.forEach((item, index) => {
      const buyers = Array.from(selections[index]);

      if (!buyers.length) {
        return;
      }

      const price = Number(item.price);
      const share = Math.floor(price / buyers.length);
      const remain = price % buyers.length;

      buyers.forEach((person, buyerIndex) => {
        totals[person] += share + (buyerIndex < remain ? 1 : 0);
      });
    });

    const lines = ["===================================", "더치페이 결과", "==================================="];
    let total = 0;

    people.forEach((person) => {
      lines.push(`${person.padEnd(10, " ")} : ${totals[person].toLocaleString().padStart(7, " ")}원`);
      total += totals[person];
    });

    lines.push("===================================");
    lines.push(`총 합계 : ${total.toLocaleString()}원`);

    summaryText.textContent = lines.join("\n");
    summaryNode.hidden = false;
    summaryNode.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  resultsNode.appendChild(calcButton);
}

receiptInput.addEventListener("change", () => {
  renderPreview(receiptInput.files?.[0]);
});

analyzeButton.addEventListener("click", async () => {
  const file = receiptInput.files?.[0];

  if (!file) {
    setStatus("영수증 이미지를 선택해주세요.");
    return;
  }

  const people = parsePeople();

  if (!people.length) {
    setStatus("참여자를 입력해주세요.");
    return;
  }

  setStatus("분석 중... OCR과 LLM을 호출하고 있습니다.");
  analyzeButton.disabled = true;

  try {
    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch("/api/analyze", {
      method: "POST",
      body: formData,
    });

    const responseText = await response.text();
    let data = {};

    if (responseText.trim()) {
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(responseText || "서버 응답을 읽지 못했습니다.");
      }
    }

    if (!response.ok) {
      throw new Error(data.error || responseText || "분석에 실패했습니다.");
    }

    items = Array.isArray(data.items) ? data.items : [];

    if (!items.length) {
      setStatus("추출된 품목이 없습니다.");
      resultsNode.innerHTML = '<div class="placeholder">품목을 찾지 못했습니다. 다른 이미지를 시도해보세요.</div>';
      return;
    }

    setStatus(`${items.length}개의 품목을 찾았습니다. 체크박스를 선택한 뒤 계산하세요.`);
    renderItems();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "알 수 없는 오류가 발생했습니다.");
    resultsNode.innerHTML = `<div class="placeholder">${error.message || "분석에 실패했습니다."}</div>`;
  } finally {
    analyzeButton.disabled = false;
  }
});

resetButton.addEventListener("click", () => {
  receiptInput.value = "";
  peopleInput.value = "";
  resultsNode.innerHTML = '<div class="placeholder">아직 분석된 품목이 없습니다.</div>';
  summaryNode.hidden = true;
  items = [];
  selections = [];
  renderPreview(null);
  setStatus("초기화되었습니다.");
});

renderPreview(null);
resultsNode.innerHTML = '<div class="placeholder">아직 분석된 품목이 없습니다.</div>';