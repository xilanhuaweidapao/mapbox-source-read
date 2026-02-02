export function createPanel({ title = "Controls", container = document.body } = {}) {
  const panel = document.createElement("div");
  panel.style.position = "fixed";
  panel.style.left = "12px";
  panel.style.top = "12px";
  panel.style.padding = "10px 12px";
  panel.style.background = "rgba(0,0,0,0.7)";
  panel.style.color = "#fff";
  panel.style.font = "12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  panel.style.border = "1px solid rgba(255,255,255,0.15)";
  panel.style.borderRadius = "8px";
  panel.style.maxWidth = "360px";
  panel.style.zIndex = 10;

  const h = document.createElement("div");
  h.textContent = title;
  h.style.fontWeight = "600";
  h.style.marginBottom = "8px";
  panel.appendChild(h);

  container.appendChild(panel);

  function row(labelText) {
    const r = document.createElement("div");
    r.style.display = "flex";
    r.style.alignItems = "center";
    r.style.gap = "8px";
    r.style.margin = "6px 0";

    const label = document.createElement("div");
    label.textContent = labelText;
    label.style.flex = "0 0 auto";
    label.style.minWidth = "120px";
    label.style.opacity = "0.9";
    r.appendChild(label);

    panel.appendChild(r);
    return { r, label };
  }

  function addText(labelText, initial = "") {
    const { r } = row(labelText);
    const value = document.createElement("div");
    value.textContent = initial;
    value.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    value.style.whiteSpace = "pre";
    r.appendChild(value);
    return {
      set: (v) => {
        value.textContent = String(v);
      },
    };
  }

  function addCheckbox(labelText, initial, onChange) {
    const { r } = row(labelText);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(initial);
    input.addEventListener("change", () => onChange?.(input.checked));
    r.appendChild(input);
    return input;
  }

  function addSlider(labelText, { min, max, step, value }, onChange) {
    const { r } = row(labelText);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.flex = "1 1 auto";

    const out = document.createElement("div");
    out.textContent = String(value);
    out.style.minWidth = "42px";
    out.style.textAlign = "right";
    out.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    out.style.opacity = "0.9";

    input.addEventListener("input", () => {
      out.textContent = input.value;
      onChange?.(Number(input.value));
    });

    r.appendChild(input);
    r.appendChild(out);
    return input;
  }

  function addSelect(labelText, options, initial, onChange) {
    const { r } = row(labelText);
    const select = document.createElement("select");
    select.style.flex = "1 1 auto";
    select.style.maxWidth = "200px";
    for (const { label, value } of options) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    }
    select.value = initial;
    select.addEventListener("change", () => onChange?.(select.value));
    r.appendChild(select);
    return select;
  }

  function addButton(labelText, onClick) {
    const { r, label } = row("");
    label.remove();
    const btn = document.createElement("button");
    btn.textContent = labelText;
    btn.style.cursor = "pointer";
    btn.addEventListener("click", () => onClick?.());
    r.appendChild(btn);
    return btn;
  }

  function addSeparator() {
    const hr = document.createElement("div");
    hr.style.height = "1px";
    hr.style.margin = "8px 0";
    hr.style.background = "rgba(255,255,255,0.15)";
    panel.appendChild(hr);
  }

  return { panel, addText, addCheckbox, addSlider, addSelect, addButton, addSeparator };
}

