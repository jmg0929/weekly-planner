// Semgrep 규칙 테스트 (semgrep --test .semgrep) — "ruleid:" 다음 줄은 잡혀야 하고, "ok:" 다음 줄은 잡히면 안 됨
// index.html에서 실제로 쓰는 모양(문자열 이어 붙이기 · forEach 안에서 h+= · map().join)을 그대로 흉내 냄

function badDirect(t, el) {
  // ruleid: planner-innerhtml-unescaped
  el.innerHTML = '<div class="ttx">' + t.title + "</div>";
}

function badLoop(categories, box) {
  var h = "";
  categories.forEach(function (c) {
    h += '<button data-cat="' + c.id + '">' + c.name + "</button>";
  });
  // ruleid: planner-innerhtml-unescaped
  box.innerHTML = h;
}

function badMap(list, box) {
  // ruleid: planner-innerhtml-unescaped
  box.innerHTML = list.map(function (e) { return "<span>" + e.location + "</span>"; }).join("");
}

function badInput(row) {
  var q = document.getElementById("q");
  // ruleid: planner-innerhtml-unescaped
  row.insertAdjacentHTML("beforeend", "<b>" + q.value + "</b>");
}

function badHash(el) {
  // ruleid: planner-innerhtml-unescaped
  el.innerHTML = "<p>" + decodeURIComponent(location.hash.slice(1)) + "</p>";
}

function okEscaped(t, el) {
  // ok: planner-innerhtml-unescaped
  el.innerHTML = '<div class="ttx">' + esc(t.title) + "</div>";
}

function okLoopEscaped(categories, box) {
  var h = "";
  categories.forEach(function (c) {
    h += '<button data-cat="' + c.id + '">' + (c.emoji ? esc(c.emoji) + " " : "") + esc(c.name) + "</button>";
  });
  // ok: planner-innerhtml-unescaped
  box.innerHTML = h;
}

function okNumbers(e, el) {
  // ok: planner-innerhtml-unescaped
  el.innerHTML = '<div class="tnum">' + minToStr(e.start) + " ~ " + minToStr(e.end) + "</div>";
}

function okTextContent(t, el) {
  // ok: planner-innerhtml-unescaped
  el.textContent = t.title;
}

function badEval(s) {
  // ruleid: planner-string-to-code
  eval(s);
  // ruleid: planner-string-to-code
  setTimeout("render()", 10);
  // ok: planner-string-to-code
  setTimeout(render, 10);
}

// ruleid: planner-server-key-in-client
var SERVICE_ROLE_KEY = "...";
// ok: planner-server-key-in-client
var SB_KEY = "sb_publishable_example";
