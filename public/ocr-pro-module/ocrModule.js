/*  public/ocr-pro-module/ocrModule.js
 *  ---------------------------------------------------------------
 *  Lógica front-end del OCR Pro-Module
 *    • Drag-drop / file input  → preview
 *    • POST /​api/ocr  → recibe jugadas, pinta tabla
 *    • Checkbox por jugada  →  "Añadir al formulario" usa window.opener
 *  --------------------------------------------------------------- */

(() => {
  /* ------------- refs DOM ---------------- */
  const dropZone   = document.getElementById("dropZone");
  const fileInput  = document.getElementById("fileInput");
  const previewImg = document.getElementById("previewImg");
  const btnSelect  = document.getElementById("btnSelect");
  const btnProcess = document.getElementById("btnProcess");
  const btnReset   = document.getElementById("btnReset");
  const progressW  = document.getElementById("progressWrap");
  const progressB  = document.getElementById("progressBar");
  const progressT  = document.getElementById("progressTxt");
  const tblBody    = document.querySelector("#tblJugadas tbody");
  const btnAddForm = document.getElementById("btnAddToForm");

  let selectedFile = null;
  let ocrJugadas   = [];

  /* ========== Drag-drop & file ========== */
  function resetAll() {
    selectedFile = null;
    ocrJugadas   = [];
    previewImg.style.display = "none";
    fileInput.value = "";
    tblBody.innerHTML = "";
    progressW.style.display = "none";
    btnProcess.disabled = true;
    btnReset.disabled   = true;
    btnAddForm.disabled = true;
  }

  dropZone.addEventListener("click", () => fileInput.click());

  btnSelect.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", e => {
    e.preventDefault(); dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", e => {
    e.preventDefault(); dropZone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  function handleFile(file) {
    selectedFile = file;
    previewImg.src = URL.createObjectURL(file);
    previewImg.style.display = "block";
    btnProcess.disabled = false;
    btnReset.disabled   = false;
  }

  btnReset.addEventListener("click", resetAll);

  /* ========== Procesar OCR ========== */
  btnProcess.addEventListener("click", async () => {
    if (!selectedFile) return;
    try {
      btnProcess.disabled = true;
      progressW.style.display = "block";
      progressB.style.width = "0%";
      progressT.innerText = "Subiendo…";

      // fake progress
      let p = 0;
      const int = setInterval(() => {
        p = Math.min(p + 7, 90);
        progressB.style.width = p + "%";
      }, 400);

      const fd = new FormData();
      fd.append("ticket", selectedFile);

      const res = await fetch("/api/ocr", { method: "POST", body: fd });
      clearInterval(int);
      progressB.style.width = "100%";
      progressT.innerText = "Procesando…";

      const data = await res.json();
      progressW.style.display = "none";
      if (!data.success) {
        alert("OCR error: " + data.error);
        btnProcess.disabled = false;
        return;
      }
      ocrJugadas = data.resultado.jugadas || [];
      renderTable();
    } catch (err) {
      alert("Error enviando OCR: " + err.message);
      btnProcess.disabled = false;
    }
  });

  /* ========== Render tabla ========== */
  function renderTable() {
    tblBody.innerHTML = "";
    if (!ocrJugadas.length) {
      tblBody.innerHTML = `<tr><td colSpan="5">Sin jugadas detectadas.</td></tr>`;
      return;
    }
    ocrJugadas.forEach((j, idx) => {
      const tr = document.createElement("tr");
      if (j.esDudoso) tr.classList.add("dudoso");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${j.numeros || "-"}</td>
        <td>${j.modalidad || "-"}</td>
        <td>${(j.montoApostado ?? 0).toFixed(2)}</td>
        <td class="text-center">
          <input type="checkbox" class="form-check-input" data-idx="${idx}" checked>
        </td>`;
      tblBody.appendChild(tr);
    });
    btnAddForm.disabled = false;
  }

  /* ========== Añadir al formulario principal ========== */
  btnAddForm.addEventListener("click", () => {
    const opener = window.opener;
    if (!opener || typeof opener.addMainRow !== "function") {
      alert("No se encontró el formulario principal (¿pestaña cerrada?).");
      return;
    }

    const checks = tblBody.querySelectorAll('input[type="checkbox"]:checked');
    if (!checks.length) {
      alert("No hay jugadas seleccionadas.");
      return;
    }

    checks.forEach(chk => {
      const j   = ocrJugadas[parseInt(chk.dataset.idx, 10)];
      if (!j) return;

      /* Invocamos helper existente en la página principal */
      const row = opener.addMainRow();
      if (!row) return;

      /* Completar campos */
      row.find(".betNumber").val(j.numeros || "");
      row.find(".straight").val((j.montoApostado ?? 0).toString());
      row.find(".box").val("");
      row.find(".combo").val("");
      opener.recalcMainRow(row);
    });

    opener.highlightDuplicatesInMain?.();
    opener.storeFormState?.();

    alert(`${checks.length} jugada(s) añadidas.`);
    window.close();
  });

  /* Auto-reset al cargar */
  resetAll();
})();
