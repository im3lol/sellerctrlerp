/**
 * Element picker injected into the product page. The side panel "arms" a field;
 * the next element the user clicks is captured: we compute a robust CSS selector,
 * infer the attribute, read the sample value, and report back to the side panel.
 */
(() => {
  if (window.__sellerctrlPicker) return; // avoid double-injection
  window.__sellerctrlPicker = true;

  let armedField = null;
  let hovered = null;

  const HL_OUTLINE = "2px solid #0A33D1";
  const HL_BG = "rgba(247, 197, 45, 0.25)";

  // Floating hint banner.
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);" +
    "background:#0A33D1;color:#fff;padding:8px 16px;border-radius:9999px;font-size:13px;" +
    "font-family:system-ui,Segoe UI,Tahoma,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);" +
    "direction:rtl;pointer-events:none;display:none;max-width:90vw;";
  document.documentElement.appendChild(banner);

  function showBanner(text) {
    banner.textContent = text;
    banner.style.display = "block";
  }
  function hideBanner() {
    banner.style.display = "none";
  }

  function setHover(el) {
    if (hovered && hovered !== el) {
      hovered.style.outline = hovered.__prevOutline || "";
      hovered.style.backgroundColor = hovered.__prevBg || "";
    }
    if (el) {
      el.__prevOutline = el.style.outline;
      el.__prevBg = el.style.backgroundColor;
      el.style.outline = HL_OUTLINE;
      el.style.backgroundColor = HL_BG;
    }
    hovered = el;
  }

  function onMove(e) {
    if (!armedField) return;
    const el = e.target;
    if (el && el !== banner) setHover(el);
  }

  /** Robust structural CSS selector (id shortcut, else nth-of-type path). */
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      let sel = node.nodeName.toLowerCase();
      let nth = 1;
      let sib = node;
      while ((sib = sib.previousElementSibling)) {
        if (sib.nodeName === node.nodeName) nth++;
      }
      sel += `:nth-of-type(${nth})`;
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  /** Infer which attribute to read for this element. */
  function inferAttr(el) {
    const tag = el.nodeName.toLowerCase();
    if (tag === "img") return "src";
    if (tag === "meta") return "content";
    if (tag === "source") return "src";
    if (tag === "a" && !(el.textContent || "").trim()) return "href";
    return "text";
  }

  function readValue(el, attr) {
    const toAbs = (v) => {
      try {
        return new URL(v, location.href).href;
      } catch {
        return v;
      }
    };
    if (attr === "text") return (el.textContent || "").replace(/\s+/g, " ").trim();
    if (attr === "src") return toAbs(el.currentSrc || el.getAttribute("src") || el.src || "");
    if (attr === "href") return toAbs(el.getAttribute("href") || el.href || "");
    if (attr === "content") return el.getAttribute("content") || "";
    return el.getAttribute(attr) || "";
  }

  function onClick(e) {
    if (!armedField) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    const selector = cssPath(el);
    const attr = inferAttr(el);
    const value = readValue(el, attr);
    const field = armedField;
    // disarm
    armedField = null;
    setHover(null);
    hideBanner();
    chrome.runtime.sendMessage({ type: "picked", field, selector, attr, value });
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);

  function flash(el) {
    const prevOutline = el.style.outline;
    const prevBg = el.style.backgroundColor;
    el.style.outline = "3px solid #F7C52D";
    el.style.backgroundColor = "rgba(10, 51, 209, 0.12)";
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.backgroundColor = prevBg;
    }, 700);
  }

  // Live run: extract all fields on the current page using the saved selectors.
  function extractAll(fields) {
    const data = {};
    for (const [key, def] of Object.entries(fields)) {
      const el = document.querySelector(def.selector);
      if (!el) continue;
      flash(el);
      const value = readValue(el, def.attr || "text");
      if (value) data[key] = value;
    }
    return data;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "extract") {
      showBanner("⏳ يسحب البيانات…");
      const data = extractAll(msg.fields || {});
      setTimeout(hideBanner, 900);
      sendResponse({ ok: true, data });
      return true;
    }
    if (msg?.type === "armPick") {
      armedField = msg.field;
      showBanner(`اضغط على عنصر «${msg.labelAr || msg.field}» في الصفحة لالتقاطه`);
      sendResponse({ ok: true });
    } else if (msg?.type === "disarm") {
      armedField = null;
      setHover(null);
      hideBanner();
      sendResponse({ ok: true });
    } else if (msg?.type === "ping") {
      sendResponse({ ok: true });
    }
    return true;
  });
})();
