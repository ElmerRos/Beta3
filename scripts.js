 /*
  scripts.js - Full version aligned with the new index.html.

  Main features:
  1) Table in the main form (#jugadasTable).
     - Each row has a red button in the first column to remove that specific play.

  2) Wizard Modal:
     - A separate table (#wizardTable) to hold the plays the user adds or generates
       (Quick Pick, Round Down) BEFORE sending them to the main table.
     - Candaditos for Straight/Box/Combo.
     - Quick Pick and Round Down sections.
     - "Add All to Main" to transfer Wizard plays to the main table.

  3) LocalStorage persists the main form data (not the wizard table).
     - Once we move Wizard data to the main table, it becomes part of local storage.

  4) The rest of your standard logic (cutoff times, dayjs, generate ticket,
     confirm & print, share ticket, etc.) is also integrated.

  Make sure you have the correct references in your index.html to #wizardTable,
  #wizardTableBody, #lockStraight, #lockBox, #lockCombo, etc.
*/

/* Replace with your real SheetDB (or API) endpoint if needed */
const SHEETDB_API_URL = 'https://sheetdb.io/api/v1/bl57zyh73b0ev';

$(document).ready(function() {
  // Setup dayjs plugin usage
  dayjs.extend(dayjs_plugin_customParseFormat);
  dayjs.extend(dayjs_plugin_arraySupport);

  /* =====================================
     GLOBALS
  ===================================== */
  let transactionDateTime = '';
  let betData = [];
  let isProgrammaticReset = false;
  window.ticketImageDataUrl = null;

  // In the main table
  let playCount = 0;            // how many plays in the main form
  let selectedTracksCount = 0;  
  let selectedDaysCount = 0;    
  const MAX_PLAYS = 25;

  // For the wizard table
  // We'll store plays in DOM only, not in localStorage until
  // we move them to the main table.
  let wizardCount = 0;  // how many plays in the wizard table

  // Candado states
  const lockedFields = {
    straight: false,
    box: false,
    combo: false
  };

  // For cutoff times
  const cutoffTimes = {
    "USA": {
      "New York Mid Day": "14:20",
      "New York Evening": "22:00",
      "Georgia Mid Day": "12:20",
      "Georgia Evening": "18:40",
      "New Jersey Mid Day": "12:50",
      "New Jersey Evening": "22:00",
      "Florida Mid Day": "13:20",
      "Florida Evening": "21:30",
      "Connecticut Mid Day": "13:30",
      "Connecticut Evening": "22:00",
      "Georgia Night": "22:00",
      "Pensilvania AM": "12:45",
      "Pensilvania PM": "18:15",
      "Brooklyn Midday": "14:20",
      "Brooklyn Evening": "22:00",
      "Front Midday": "14:20",
      "Front Evening": "22:00"
    },
    "Santo Domingo": {
      "Real": "11:45",
      "Gana mas": "13:25",
      "Loteka": "18:30",
      "Nacional": "19:30",
      "Quiniela Pale": "19:30",
      "Primera Día": "10:50",
      "Suerte Día": "11:20",
      "Lotería Real": "11:50",
      "Suerte Tarde": "16:50",
      "Lotedom": "16:50",
      "Primera Noche": "18:50",
      "Panama": "16:00"
    },
    "Venezuela": {
      "Venezuela": "00:00"
    }
  };

  // Bet limits for each mode
  const betLimits = {
    "Win 4":         { straight: 6,  box: 30, combo: 6 },
    "Pick 3":        { straight: 35, box: 50, combo: 35 },
    "Venezuela":     { straight: 100 },
    "Venezuela-Pale":{ straight: 100 },
    "Pulito":        { straight: 100 },
    "RD-Quiniela":   { straight: 100 },
    "RD-Pale":       { straight: 20 }
  };


  /* =====================================
     FLATPICKR, DATE & TRACKS
  ===================================== */
  flatpickr("#fecha", {
    mode: "multiple",
    dateFormat: "m-d-Y",
    minDate: "today",
    clickOpens: true,
    allowInput: false,
    appendTo: document.body,
    onReady: function(selectedDates, dateStr, instance) {
      instance.calendarContainer.style.zIndex = 999999;
    },
    onChange: function(selectedDates, dateStr, instance) {
      selectedDaysCount = selectedDates.length;
      calculateTotal();
      storeFormState();
      disableTracksByTime();
    }
  });

  $(".track-checkbox").change(function(){
    const arr = $(".track-checkbox:checked").map(function(){return $(this).val();}).get();
    // If no tracks except "Venezuela", we might do something:
    // but let's keep your logic of counting as well.
    selectedTracksCount = arr.filter(x => x !== "Venezuela").length || 1;
    calculateTotal();
    disableTracksByTime();
  });


  /* =====================================
     MAIN TABLE LOGIC
  ===================================== */

  // The main table #jugadasTable, body #tablaJugadas
  // We'll generate rows dynamically with addMainTableRow().

  function addMainTableRow(playIndex, bn, gm, stVal, bxVal, coVal, totalVal) {
    /*
      We generate a <tr> with:
      1) <td> -> a red button with data-row=playIndex
      2) <td> -> Bet Number
      3) <td> -> Game Mode
      4) <td> -> Straight
      5) <td> -> Box
      6) <td> -> Combo
      7) <td> -> Total
    */
    const rowHTML = `
      <tr data-playIndex="${playIndex}">
        <td>
          <button type="button"
            class="removeMainBtn btnRemovePlay"
            data-row="${playIndex}">
            ${playIndex}
          </button>
        </td>
        <td>${bn}</td>
        <td>${gm}</td>
        <td>${stVal || "-"}</td>
        <td>${bxVal || "-"}</td>
        <td>${coVal || "-"}</td>
        <td>${parseFloat(totalVal || 0).toFixed(2)}</td>
      </tr>
    `;
    $("#tablaJugadas").append(rowHTML);
  }

  // Remove row from main table
  $("#tablaJugadas").on("click",".removeMainBtn", function(){
    $(this).closest("tr").remove();
    renumberMainTable();
    calculateTotal();
  });

  // Renumber the main table after removing a row
  function renumberMainTable() {
    let i = 0;
    $("#tablaJugadas tr").each(function(){
      i++;
      $(this).attr("data-playIndex", i);
      const btn = $(this).find(".removeMainBtn");
      btn.attr("data-row", i);
      btn.text(i);
    });
    playCount = i;
    storeFormState();
  }

  // Recalculate total for the entire main table
  function calculateTotal() {
    // sum all the .total columns in #jugadasTable
    let sum = 0;
    $("#tablaJugadas tr").each(function(){
      const totalCell = $(this).find("td").eq(6).text(); // 7th column
      sum += parseFloat(totalCell) || 0;
    });
    if(selectedDaysCount === 0) {
      sum = 0;
    } else {
      sum = (sum * selectedTracksCount * selectedDaysCount).toFixed(2);
    }
    $("#totalJugadas").text(sum);
    storeFormState();
  }


  /* =====================================
     WIZARD TABLE LOGIC
     (#wizardTable / #wizardTableBody)
  ===================================== */
  // We'll add rows to the Wizard table for each new play (manual, quick pick, round down)
  // The user can remove them individually with a red button, then "Add All to Main" eventually.

  function addWizardRow(bn, gm, stVal, bxVal, coVal, totalVal) {
    // wizardCount is how many rows we have in the wizard table
    wizardCount++;
    const rowIndex = wizardCount;
    const rowHTML = `
      <tr data-wizardIndex="${rowIndex}">
        <td>
          <button type="button"
            class="removeWizardBtn btnRemovePlay"
            data-row="${rowIndex}">
            ${rowIndex}
          </button>
        </td>
        <td>${bn}</td>
        <td>${gm}</td>
        <td>${stVal || "-"}</td>
        <td>${bxVal || "-"}</td>
        <td>${coVal || "-"}</td>
        <td>${parseFloat(totalVal || 0).toFixed(2)}</td>
      </tr>
    `;
    $("#wizardTableBody").append(rowHTML);
  }

  // Remove row from wizard table
  $("#wizardTableBody").on("click",".removeWizardBtn", function(){
    $(this).closest("tr").remove();
    renumberWizardTable();
  });

  function renumberWizardTable() {
    let i = 0;
    $("#wizardTableBody tr").each(function(){
      i++;
      $(this).attr("data-wizardIndex", i);
      const btn = $(this).find(".removeWizardBtn");
      btn.attr("data-row", i);
      btn.text(i);
    });
    wizardCount = i;
  }


  /* =====================================
     DETERMINE GAME MODE
  ===================================== */
  function determineGameMode(betNumber) {
    /*
      We only know which mode if we see which tracks are selected.
      Or we do a simpler approach: if length=4 => Win4, length=3 => Pick3, etc.
      However, your logic also states that if there's "Venezuela" + length=2 => ...
      Let's do something consistent:
    */
    const tracks = $(".track-checkbox:checked").map(function(){return $(this).val();}).get();
    let mode = "-";
    const isUSA = tracks.some(t => Object.keys(cutoffTimes.USA).includes(t));
    const isSD  = tracks.some(t => Object.keys(cutoffTimes["Santo Domingo"]).includes(t));
    const includesVenezuela = tracks.includes("Venezuela");
    const length = betNumber.length;

    if (includesVenezuela && isUSA) {
      if (length === 2) {
        mode = "Venezuela";
      } else if (length === 4) {
        mode = "Venezuela-Pale";
      }
    }
    else if (isUSA && !isSD) {
      if (length === 4) {
        mode = "Win 4";
      } else if (length === 3) {
        mode = "Pick 3";
      } else if (length === 2) {
        mode = "Pulito";
      }
    }
    else if (isSD && !isUSA) {
      if (length === 2) {
        mode = "RD-Quiniela";
      } else if (length === 4) {
        mode = "RD-Pale";
      }
    }
    return mode;
  }

  /* A helper to calculate total for a single row (bn, gm, st, box, combo). */
  function calculateRowTotal(bn, gm, stVal, bxVal, coVal) {
    let totalVal = 0;
    // parse
    const st = parseFloat(stVal) || 0;
    const combo = parseFloat(coVal) || 0;
    let box = 0;
    // for "box", we might have "1,2 or 3". Usually a numeric?
    // if gm===Pulito => box can have multiple positions => st* (# positions).
    // but let's keep it simpler: if gm===Pulito => interpret box as list
    // else parse it as float
    if(gm==="Pulito" && bxVal){
      // e.g. "1,3"
      const positions = bxVal.split(",").map(x=>x.trim()).filter(Boolean);
      totalVal = st * positions.length; // ignoring combo for Pulito?
      return totalVal.toFixed(2);
    }

    if(gm==="Win 4" || gm==="Pick 3"){
      // might parse box as float
      const numericBox = parseFloat(bxVal) || 0;
      // combos => permutations?
      const combosCount = calcCombos(bn);
      totalVal = st + numericBox + (combo * combosCount);
    }
    else if(gm==="Venezuela" || gm.startsWith("RD-")){
      // only straight
      totalVal = st;
    }
    else {
      // general
      const numericBox = parseFloat(bxVal) || 0;
      totalVal = st + numericBox + combo;
    }
    return totalVal.toFixed(2);
  }

  function calcCombos(str) {
    const freq = {};
    for (let c of str) {
      freq[c] = (freq[c] || 0) + 1;
    }
    const factorial = n => (n <= 1 ? 1 : n * factorial(n - 1));
    let denom = 1;
    for (const k in freq) {
      denom *= factorial(freq[k]);
    }
    return factorial(str.length) / denom;
  }

  /* =====================================
     MAIN FORM: RESET & OTHERS
  ===================================== */
  $("#resetForm").click(function(){
    if(confirm("Are you sure you want to reset the form? This will remove all current plays.")){
      resetForm();
    }
  });

  function resetForm() {
    isProgrammaticReset = true;
    $("#lotteryForm")[0].reset();
    $("#tablaJugadas").empty();
    playCount=0;
    selectedTracksCount=0;
    selectedDaysCount=0;
    window.ticketImageDataUrl = null;
    $("#totalJugadas").text("0.00");
    localStorage.removeItem("formState");

    showCutoffTimes();
    disableTracksByTime();
    // done
    isProgrammaticReset = false;
  }


  /* =====================================
     Add a single row from main form logic (unused?)
     Because now we typically do from Wizard. But let's keep it if user hits "Add Play".
  ===================================== */
  $("#agregarJugada").click(function(){
    // maybe ask for a simple approach or create a manual row with input fields?
    // If you want old approach, you can do it. For now let's do minimal:
    if(playCount>=MAX_PLAYS){
      alert("You have reached the maximum of 25 plays in the main form.");
      return;
    }
    playCount++;
    // create a blank row?
    addMainTableRow(playCount, "???", "-", "", "", "", 0);
    calculateTotal();
  });

  // Remove last row
  $("#eliminarJugada").click(function(){
    if(playCount===0){
      alert("No plays to remove.");
      return;
    }
    $("#tablaJugadas tr:last").remove();
    playCount--;
    renumberMainTable();
    calculateTotal();
  });


  /* =====================================
     localStorage / storeFormState
  ===================================== */
  function storeFormState(){
    // We'll store the main table's data
    // (Wizard table isn't stored in localStorage)
    const st = {
      playCount,
      selectedTracksCount,
      selectedDaysCount,
      dateVal: $("#fecha").val(),
      plays: []
    };
    $("#tablaJugadas tr").each(function(){
      const rowNum = parseInt($(this).attr("data-playIndex"));
      const tds = $(this).find("td");
      const bn = tds.eq(1).text(); // Bet Number
      const gm = tds.eq(2).text(); // Game Mode
      const stv= tds.eq(3).text(); // Straight
      const bxv= tds.eq(4).text(); // Box
      const cov= tds.eq(5).text(); // Combo
      const tot= tds.eq(6).text(); // Total

      st.plays.push({
        betNumber: bn,
        gameMode: gm,
        straight: (stv==="-"?"":stv),
        box:      (bxv==="-"?"":bxv),
        combo:    (cov==="-"?"":cov),
        total: tot
      });
    });
    localStorage.setItem("formState", JSON.stringify(st));
  }

  function loadFormState(){
    const data = JSON.parse(localStorage.getItem("formState"));
    if(!data) return;
    $("#fecha").val(data.dateVal);
    selectedDaysCount = data.selectedDaysCount;
    selectedTracksCount = data.selectedTracksCount;
    playCount = data.playCount;
    $("#tablaJugadas").empty();

    // build each row
    let i=0;
    data.plays.forEach((p)=>{
      i++;
      addMainTableRow(i, p.betNumber, p.gameMode, p.straight, p.box, p.combo, p.total);
    });
    playCount = i;
    calculateTotal();
    showCutoffTimes();
    disableTracksByTime();
  }

  loadFormState();


  /* =====================================
     TICKET PREVIEW & GENERATION
  ===================================== */
  $("#generarTicket").click(function(){
    doGenerateTicket();
  });

  function doGenerateTicket(){
    // Validate
    const dateVal = $("#fecha").val();
    if(!dateVal){
      alert("Please select at least one date.");
      return;
    }
    const chosenTracks = $(".track-checkbox:checked").map(function(){return $(this).val();}).get();
    if(chosenTracks.length===0){
      alert("Please select at least one track.");
      return;
    }
    const usaTracks = chosenTracks.filter(t=>Object.keys(cutoffTimes.USA).includes(t));
    if(chosenTracks.includes("Venezuela") && usaTracks.length===0){
      alert("To play 'Venezuela', you must also select at least one track from 'USA'.");
      return;
    }

    // Check cutoffs if user selected "today"
    const arrDates = dateVal.split(", ");
    const today = dayjs().startOf("day");
    for(let ds of arrDates){
      const [mm,dd,yy] = ds.split("-").map(Number);
      const picked = dayjs(new Date(yy, mm-1, dd)).startOf("day");
      if(picked.isSame(today,"day")){
        // compare time
        const now = dayjs();
        for(let t of chosenTracks){
          if(t==="Venezuela") continue;
          const raw = getTrackCutoff(t);
          if(raw){
            let co = dayjs(raw,"HH:mm");
            let cf = co.isAfter(dayjs("21:30","HH:mm"))
                       ? dayjs("22:00","HH:mm")
                       : co.subtract(10,"minute");
            if(now.isAfter(cf) || now.isSame(cf)){
              alert(`The track "${t}" is closed for today. Choose another track or date.`);
              return;
            }
          }
        }
      }
    }

    // Validate each row in main table
    let valid=true;
    const errors=[];
    $("#tablaJugadas tr").each(function(){
      const rowNum = parseInt($(this).attr("data-playIndex"));
      const tds = $(this).find("td");
      const bn = tds.eq(1).text();
      const gm = tds.eq(2).text();
      const st = tds.eq(3).text();
      const bx = tds.eq(4).text();
      const co = tds.eq(5).text();

      if(!bn || bn.length<2 || bn.length>4){
        valid=false;
        errors.push(rowNum);
      }
      if(hasBrooklynOrFront(chosenTracks) && bn.length!==3){
        valid=false;
        errors.push(rowNum);
      }
      if(gm==="-"){
        valid=false;
        errors.push(rowNum);
      }
      // more checks
      if(["Venezuela","Venezuela-Pale","Pulito","RD-Quiniela","RD-Pale"].includes(gm)){
        if(!st || parseFloat(st)<=0){
          valid=false;
          errors.push(rowNum);
        }
        if(gm==="Pulito"){
          // if box is blank => invalid
          if(!bx){
            valid=false;
            errors.push(rowNum);
          }
        }
      }
      else if(["Win 4","Pick 3"].includes(gm)){
        const sVal = parseFloat(st)||0;
        const bVal = parseFloat(bx)||0;
        const cVal = parseFloat(co)||0;
        if(sVal<=0 && bVal<=0 && cVal<=0){
          valid=false;
          errors.push(rowNum);
        }
      }
    });
    if(!valid){
      const uniqueErr = [...new Set(errors)].join(", ");
      alert(`Some plays have errors (row(s): ${uniqueErr}). Fix them before generating the ticket.`);
      return;
    }

    // Fill the PREVIEW
    $("#ticketJugadas").empty();
    $("#ticketTracks").text(chosenTracks.join(", "));
    $("#tablaJugadas tr").each(function(){
      const rowNum = parseInt($(this).attr("data-playIndex"));
      const tds = $(this).find("td");
      const bn = tds.eq(1).text();
      const gm = tds.eq(2).text();
      let stVal= tds.eq(3).text();
      let bxVal= tds.eq(4).text();
      let coVal= tds.eq(5).text();
      let rowT = tds.eq(6).text();

      if(!stVal||stVal==="-") stVal="0.00";
      if(!bxVal||bxVal==="-") bxVal="-";
      if(!coVal||coVal==="-") coVal="0.00";
      if(!rowT) rowT="0.00";

      const rowHTML=`
        <tr>
          <td>${rowNum}</td>
          <td>${bn}</td>
          <td>${gm}</td>
          <td>${parseFloat(stVal).toFixed(2)}</td>
          <td>${(bxVal==="-"? "-" : bxVal)}</td>
          <td>${parseFloat(coVal).toFixed(2)}</td>
          <td>${parseFloat(rowT).toFixed(2)}</td>
        </tr>
      `;
      $("#ticketJugadas").append(rowHTML);
    });

    $("#ticketTotal").text($("#totalJugadas").text());
    $("#ticketTransaccion").text(dayjs().format("MM/DD/YYYY hh:mm A"));
    $("#numeroTicket").text("(Not assigned yet)");
    $("#qrcode").empty();

    // Show ticket modal
    const ticketModal = new bootstrap.Modal(document.getElementById("ticketModal"));
    $("#editButton").removeClass("d-none");
    $("#shareTicket").addClass("d-none");
    $("#confirmarTicket").prop("disabled", false);

    fixTicketLayoutForMobile();
    ticketModal.show();
    storeFormState();
  }

  // confirm & print
  $("#confirmarTicket").click(function(){
    const btn = $(this);
    btn.prop("disabled",true);
    $("#editButton").addClass("d-none");

    const uniqueTicket = generateUniqueTicketNumber();
    $("#numeroTicket").text(uniqueTicket);
    transactionDateTime = dayjs().format("MM/DD/YYYY hh:mm A");
    $("#ticketTransaccion").text(transactionDateTime);

    // QR
    $("#qrcode").empty();
    new QRCode(document.getElementById("qrcode"),{
      text: uniqueTicket,
      width:128,
      height:128
    });

    $("#shareTicket").removeClass("d-none");

    const ticketElement = document.getElementById("preTicket");
    const originalStyles = {
      width: $(ticketElement).css("width"),
      height: $(ticketElement).css("height"),
      maxHeight: $(ticketElement).css("max-height"),
      overflowY: $(ticketElement).css("overflow-y")
    };
    $(ticketElement).css({
      width:"auto",
      height:"auto",
      maxHeight:"none",
      overflowY:"visible"
    });
    setTimeout(()=>{
      html2canvas(ticketElement,{scale:4})
      .then(canvas=>{
        const dataUrl=canvas.toDataURL("image/png");
        window.ticketImageDataUrl = dataUrl;
        // auto-download
        const link=document.createElement("a");
        link.href=dataUrl;
        link.download=`ticket_${uniqueTicket}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        alert("Your ticket image was downloaded successfully.");

        // Save to SheetDB
        saveBetDataToSheetDB(uniqueTicket, (success)=>{
          if(success){
            console.log("Bet data sent to SheetDB.");
          } else {
            console.error("Failed to send bet data to SheetDB.");
          }
        });
      })
      .catch(err=>{
        console.error(err);
        alert("Problem generating final ticket image. Try again.");
      })
      .finally(()=>{
        $(ticketElement).css(originalStyles);
      });
    },500);
  });

  $("#editButton").click(function(){
    const ticketModal = bootstrap.Modal.getInstance(document.getElementById("ticketModal"));
    ticketModal.hide();
  });

  $("#shareTicket").click(async function(){
    if(!window.ticketImageDataUrl){
      alert("No ticket image is available to share.");
      return;
    }
    if(navigator.canShare){
      try{
        const resp=await fetch(window.ticketImageDataUrl);
        const blob=await resp.blob();
        const file=new File([blob],"ticket.png",{type:"image/png"});
        if(navigator.canShare({files:[file]})){
          await navigator.share({
            files:[file],
            title:"Ticket",
            text:"Sharing Ticket"
          });
        } else {
          alert("Your browser does not support file sharing. Please share the downloaded image manually.");
        }
      }catch(err){
        console.error(err);
        alert("Could not share the ticket. Please try manually.");
      }
    } else {
      alert("Your browser doesn't support the Web Share API with files. Please share manually.");
    }
  });

  function saveBetDataToSheetDB(uniqueTicket, callback){
    betData=[];
    const dateVal=$("#fecha").val()||"";
    const chosenTracks=$(".track-checkbox:checked").map(function(){return $(this).val();}).get();
    const joinedTracks=chosenTracks.join(", ");
    const nowISO=dayjs().toISOString();

    $("#tablaJugadas tr").each(function(){
      const rowNum = parseInt($(this).attr("data-playIndex"));
      const tds = $(this).find("td");
      const bn = tds.eq(1).text();
      const gm = tds.eq(2).text();
      const st = tds.eq(3).text();
      const bx = tds.eq(4).text();
      const co = tds.eq(5).text();
      const total=tds.eq(6).text();
      if(gm!=="-"){
        betData.push({
          "Ticket Number": uniqueTicket,
          "Transaction DateTime": transactionDateTime,
          "Bet Dates": dateVal,
          "Tracks": joinedTracks,
          "Bet Number": bn,
          "Game Mode": gm,
          "Straight ($)": (st==="-"?"":st),
          "Box ($)": (bx==="-"?"":bx),
          "Combo ($)": (co==="-"?"":co),
          "Total ($)": total||"0.00",
          "Row Number": rowNum,
          "Timestamp": nowISO
        });
      }
    });

    fetch(SHEETDB_API_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({data:betData})
    })
    .then(r=>{
      if(!r.ok) throw new Error(`SheetDB error, status ${r.status}`);
      return r.json();
    })
    .then(d=>{
      console.log("Data stored in SheetDB:",d);
      callback(true);
    })
    .catch(e=>{
      console.error(e);
      callback(false);
    });
  }

  function generateUniqueTicketNumber(){
    return Math.floor(10000000+Math.random()*90000000).toString();
  }

  function fixTicketLayoutForMobile(){
    $("#preTicket table, #preTicket th, #preTicket td").css("white-space","nowrap");
    $("#preTicket").css("overflow-x","auto");
  }

  function hasBrooklynOrFront(tracks) {
    const bfSet = new Set(["Brooklyn Midday","Brooklyn Evening","Front Midday","Front Evening"]);
    return tracks.some(t => bfSet.has(t));
  }

  function getTrackCutoff(tn){
    for(let region in cutoffTimes){
      if(cutoffTimes[region][tn]){
        return cutoffTimes[region][tn];
      }
    }
    return null;
  }

  function showCutoffTimes(){
    $(".cutoff-time").each(function(){
      const track = $(this).data("track");
      if(track==="Venezuela") return;
      let raw="";
      if(cutoffTimes.USA[track]){
        raw=cutoffTimes.USA[track];
      } else if(cutoffTimes["Santo Domingo"][track]){
        raw=cutoffTimes["Santo Domingo"][track];
      } else if(cutoffTimes.Venezuela[track]){
        raw=cutoffTimes.Venezuela[track];
      }
      if(raw){
        let co=dayjs(raw,"HH:mm");
        let cf = co.isAfter(dayjs("21:30","HH:mm"))
                   ? dayjs("22:00","HH:mm")
                   : co.subtract(10,"minute");
        const hh=cf.format("HH");
        const mm=cf.format("mm");
        $(this).text(`${hh}:${mm}`);
      }
    });
  }

  function disableTracksByTime(){
    if(!userChoseToday()){
      enableAllTracks();
      return;
    }
    const now=dayjs();
    $(".track-checkbox").each(function(){
      const val=$(this).val();
      if(val==="Venezuela") return;
      const raw = getTrackCutoff(val);
      if(raw){
        let co=dayjs(raw,"HH:mm");
        let cf= co.isAfter(dayjs("21:30","HH:mm"))
                  ? dayjs("22:00","HH:mm")
                  : co.subtract(10,"minute");
        if(now.isAfter(cf)||now.isSame(cf)){
          $(this).prop("disabled",true).prop("checked",false);
          $(this).closest(".track-button-container").find(".track-button").css({
            opacity:0.5,
            cursor:"not-allowed"
          });
        } else {
          $(this).prop("disabled",false);
          $(this).closest(".track-button-container").find(".track-button").css({
            opacity:1,
            cursor:"pointer"
          });
        }
      }
    });
    storeFormState();
  }

  function enableAllTracks(){
    $(".track-checkbox").each(function(){
      $(this).prop("disabled",false);
      $(this).closest(".track-button-container").find(".track-button").css({
        opacity:1,
        cursor:"pointer"
      });
    });
  }

  function userChoseToday(){
    const val=$("#fecha").val();
    if(!val) return false;
    const arr = val.split(", ");
    const today = dayjs().startOf("day");
    for(let ds of arr){
      const [mm,dd,yy] = ds.split("-").map(Number);
      const picked=dayjs(new Date(yy, mm-1, dd)).startOf("day");
      if(picked.isSame(today,"day")){
        return true;
      }
    }
    return false;
  }

  showCutoffTimes();
  disableTracksByTime();
  setInterval(disableTracksByTime, 60000);


  /* =====================================
     WIZARD LOGIC
  ===================================== */
  const wizardModal = new bootstrap.Modal(document.getElementById("wizardModal"));

  // 1) Open Wizard
  $("#wizardButton").click(function(){
    // clear wizard local states
    resetWizard();
    wizardModal.show();
  });

  function resetWizard(){
    // clear all inputs
    $("#wizardBetNumber").val("");
    $("#wizardStraight").val("");
    $("#wizardBox").val("");
    $("#wizardCombo").val("");
    // reset candados
    lockedFields.straight = false;
    lockedFields.box      = false;
    lockedFields.combo    = false;
    $("#lockStraight").html(`<i class="bi bi-unlock"></i>`);
    $("#lockBox").html(`<i class="bi bi-unlock"></i>`);
    $("#lockCombo").html(`<i class="bi bi-unlock"></i>`);

    // clear wizard table
    $("#wizardTableBody").empty();
    wizardCount=0;
    // quick pick fields, round down fields
    $("#qpGameMode").val("Pick 3");
    $("#qpCount").val("5");
    $("#rdFirstNumber").val("");
    $("#rdLastNumber").val("");
  }

  // 2) Candaditos toggles
  $(".lockBtn").click(function(){
    const field = $(this).data("field"); // 'straight','box','combo'
    lockedFields[field] = !lockedFields[field];
    if(lockedFields[field]){
      // locked => show locked icon
      $(this).html(`<i class="bi bi-lock-fill"></i>`);
    } else {
      $(this).html(`<i class="bi bi-unlock"></i>`);
    }
  });


  // 3) Add & Next (manual entry)
  $("#wizardAddNext").click(function(){
    const bn = $("#wizardBetNumber").val().trim();
    if(bn.length<2||bn.length>4){
      alert("Bet Number must be 2-4 digits.");
      return;
    }
    // Determine game mode
    const gm = determineGameMode(bn);
    if(gm==="-"){
      alert(`Cannot determine game mode for number ${bn} with the selected tracks.`);
      return;
    }
    // read or keep the montos
    const stVal = $("#wizardStraight").val().trim();
    const bxVal = $("#wizardBox").val().trim();
    const coVal = $("#wizardCombo").val().trim();

    // calculate row total
    const rowTotal = calculateRowTotal(bn, gm, stVal, bxVal, coVal);
    // add to wizard table
    addWizardRow(bn, gm, stVal, bxVal, coVal, rowTotal);

    // now, if candado is open => clear the field
    // if locked => keep
    $("#wizardBetNumber").val("");

    if(!lockedFields.straight) $("#wizardStraight").val("");
    if(!lockedFields.box)      $("#wizardBox").val("");
    if(!lockedFields.combo)    $("#wizardCombo").val("");

    // focus on bet number
    $("#wizardBetNumber").focus();
  });


  // 4) Generate Quick Pick
  $("#btnGenerateQuickPick").click(function(){
    const gm = $("#qpGameMode").val();
    const countVal = parseInt($("#qpCount").val()) || 1;
    if(countVal<1||countVal>25){
      alert("Please enter a count between 1 and 25.");
      return;
    }
    // generate random plays
    // for each play, we do addWizardRow
    // the montos depend on candados
    const stVal = lockedFields.straight ? $("#wizardStraight").val().trim() : "";
    const bxVal = lockedFields.box ? $("#wizardBox").val().trim() : "";
    const coVal = lockedFields.combo ? $("#wizardCombo").val().trim() : "";

    for(let i=0; i<countVal; i++){
      let bn = generateRandomNumberForMode(gm);
      // e.g. 3 digits => pad with leading zeros if needed
      bn = padNumberForMode(bn, gm);
      const rowTotal = calculateRowTotal(bn, gm, stVal, bxVal, coVal);
      addWizardRow(bn, gm, stVal, bxVal, coVal, rowTotal);
    }
  });

  function generateRandomNumberForMode(mode){
    if(mode==="Win 4" || mode==="Venezuela-Pale" || mode==="RD-Pale"){
      return Math.floor(Math.random()*10000); // 0..9999
    }
    if(mode==="Pick 3"){
      return Math.floor(Math.random()*1000); // 0..999
    }
    if(mode==="Venezuela" || mode==="Pulito" || mode==="RD-Quiniela"){
      return Math.floor(Math.random()*100); // 0..99
    }
    // fallback
    return Math.floor(Math.random()*1000);
  }
  function padNumberForMode(num, mode){
    let length=3;
    if(mode==="Win 4"||mode==="Venezuela-Pale"||mode==="RD-Pale") length=4;
    if(mode==="Venezuela"||mode==="Pulito"||mode==="RD-Quiniela") length=2;
    let s = num.toString();
    while(s.length<length) s="0"+s;
    return s;
  }

  // 5) Generate Round Down
  $("#btnGenerateRoundDown").click(function(){
    const firstNum = $("#rdFirstNumber").val().trim();
    const lastNum  = $("#rdLastNumber").val().trim();
    if(!firstNum || !lastNum){
      alert("Please enter both first and last number.");
      return;
    }
    const fVal = parseInt(firstNum,10);
    const lVal = parseInt(lastNum,10);
    if(isNaN(fVal)||isNaN(lVal)){
      alert("Invalid numeric range. Must be integers like 110..119.");
      return;
    }
    if(lVal< fVal){
      alert("Last number must be >= first number.");
      return;
    }
    // We'll assume user has tracks selected so we can guess a mode if needed
    // But if we want to do the "determineGameMode" logic, might need length check
    // We can guess length from firstNum?
    const len = firstNum.length;
    let gmGuess = guessModeFromLength(len);
    // but we also want to check if user tracks are chosen
    // for simplicity, we'll do the same approach as manual: determineGameMode for each?
    // We'll do: let gm = determineGameMode( firstNum ) => but that might fail if e.g. 110 is ambiguous
    // Let's do a single gm from firstNum:
    let gm = determineGameMode(firstNum);
    if(gm==="-"){
      alert(`Cannot determine game mode for number ${firstNum}. Check tracks or length.`);
      return;
    }
    // Montos from candados
    const stVal = lockedFields.straight ? $("#wizardStraight").val().trim() : "";
    const bxVal = lockedFields.box ? $("#wizardBox").val().trim() : "";
    const coVal = lockedFields.combo ? $("#wizardCombo").val().trim() : "";

    // generate each consecutive number from fVal.. lVal
    for(let n=fVal; n<=lVal; n++){
      let bn = n.toString();
      // pad if needed
      while(bn.length<len) bn="0"+bn;
      let rowTotal = calculateRowTotal(bn, gm, stVal, bxVal, coVal);
      addWizardRow(bn, gm, stVal, bxVal, coVal, rowTotal);
    }
  });
  function guessModeFromLength(len){
    if(len===4) return "Win 4";
    if(len===3) return "Pick 3";
    if(len===2) return "Pulito"; // or RD-Quiniela or Venezuela
    return "-";
  }


  // 6) Add All to Main
  $("#wizardAddAllToMain").click(function(){
    // Move rows from #wizardTable to #jugadasTable
    const wizardRows = $("#wizardTableBody tr");
    if(wizardRows.length===0){
      alert("No plays in the wizard table.");
      return;
    }
    wizardRows.each(function(){
      const tds = $(this).find("td");
      const bn = tds.eq(1).text();
      const gm = tds.eq(2).text();
      const stVal = (tds.eq(3).text()==="-"?"":tds.eq(3).text());
      const bxVal = (tds.eq(4).text()==="-"?"":tds.eq(4).text());
      const coVal = (tds.eq(5).text()==="-"?"":tds.eq(5).text());
      const tot   = tds.eq(6).text();

      if(playCount>=MAX_PLAYS){
        alert("Reached 25 plays in main form. Stopping import from wizard.");
        return false; // break .each
      }
      playCount++;
      addMainTableRow(playCount, bn, gm, stVal, bxVal, coVal, tot);
    });
    // remove them from wizard table
    $("#wizardTableBody").empty();
    wizardCount=0;
    calculateTotal();
    storeFormState();
  });

  // 7) Generate Ticket from Wizard
  $("#wizardGenerateTicket").click(function(){
    // 1) Add All to Main
    $("#wizardAddAllToMain").trigger("click");
    // 2) Then doGenerateTicket
    wizardModal.hide();
    doGenerateTicket();
  });

  // 8) Edit Main Form
  $("#wizardEditMainForm").click(function(){
    wizardModal.hide();
  });



  /* 
    ============ THE END =============
    With this, your wizard should allow:
      - manual bet + Add & Next
      - quick pick generation
      - round down generation
      - all stored in #wizardTable
      - remove individual wizard plays (red button #)
      - "Add All to Main" to finalize them in the main table
      - Then normal "Generate Ticket" logic or from the wizard
  */
}); // end document.ready
