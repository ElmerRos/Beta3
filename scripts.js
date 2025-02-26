 /* =========================================================
   SCRIPTS.JS COMPLETO
   (Con scale=2, JPEG 0.8, wizard, localStorage, combos, etc.)
   + Ajuste final:
      1) Se quita location.href = "manual.html"
      2) Se añade tutorial Intro.js y show/hide del manual
========================================================= */

const SHEETDB_API_URL = 'https://sheetdb.io/api/v1/bl57zyh73b0ev';

$(document).ready(function() {

  // ----------------------------------------------------------------
  // [1] TUS EXTENSIONES, VARIABLES Y SETUP INICIAL
  // ----------------------------------------------------------------
  // Extensiones dayjs
  dayjs.extend(dayjs_plugin_customParseFormat);
  dayjs.extend(dayjs_plugin_arraySupport);

  let transactionDateTime = '';
  window.ticketImageDataUrl = null;

  let selectedTracksCount = 0;
  let selectedDaysCount = 0;
  const MAX_PLAYS = 25;

  let playCount = 0;         // Filas en la tabla principal
  let wizardCount = 0;       // Filas en la tabla Wizard

  // Candados en Wizard
  const lockedFields = {
    straight: false,
    box: false,
    combo: false
  };

  // ----------------------------------------------------------------
  // [2] CUTOFF TIMES
  // ----------------------------------------------------------------
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
      "Venezuela": "00:00",
      "Brooklyn Midday": "14:20",
      "Brooklyn Evening": "22:00",
      "Front Midday": "14:20",
      "Front Evening": "22:00",
      "New York Horses": "16:00"
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

  // ----------------------------------------------------------------
  // [3] INIT FLATPICKR
  // ----------------------------------------------------------------
  const fp = flatpickr("#fecha", {
    mode: "multiple",
    dateFormat: "m-d-Y",
    minDate: "today",
    defaultDate: [ new Date() ],
    clickOpens: true,
    allowInput: false,
    appendTo: document.body,
    onOpen: function() {
      this.calendarContainer.style.transform = 'scale(2.0)';
      this.calendarContainer.style.transformOrigin = 'top left';
    },
    onClose: function() {
      this.calendarContainer.style.transform = '';
    },
    onReady: function(selectedDates, dateStr, instance){
      if(!dateStr || dateStr.trim()===""){
        instance.setDate(new Date(), true);
      }
    },
    onChange: (selectedDates) => {
      selectedDaysCount = selectedDates.length;
      calculateMainTotal();
      storeFormState();
      disableTracksByTime();
    }
  });

  // ----------------------------------------------------------------
  // [4] TRACK CHECKBOXES
  // ----------------------------------------------------------------
  $(".track-checkbox").change(function(){
    const arr = $(".track-checkbox:checked")
      .map(function(){return $(this).val();})
      .get();
    selectedTracksCount = arr.filter(x => x !== "Venezuela").length || 1;
    calculateMainTotal();
    disableTracksByTime();
  });

  // ----------------------------------------------------------------
  // [5] MAIN TABLE => Add/Remove
  // ----------------------------------------------------------------
  $("#agregarJugada").click(function(){
    const row = addMainRow();
    if(row) row.find(".betNumber").focus();
  });

  $("#eliminarJugada").click(function(){
    if(playCount === 0) {
      alert("No plays to remove.");
      return;
    }
    $("#tablaJugadas tr:last").remove();
    playCount--;
    renumberMainRows();
    calculateMainTotal();
    highlightDuplicatesInMain();
  });

  $("#tablaJugadas").on("click",".removeMainBtn",function(){
    $(this).closest("tr").remove();
    playCount--;
    renumberMainRows();
    calculateMainTotal();
    highlightDuplicatesInMain();
  });

  $("#tablaJugadas").on("input", ".betNumber, .straight, .box, .combo", function(){
    const row = $(this).closest("tr");
    recalcMainRow(row);
    highlightDuplicatesInMain();
    storeFormState();
  });

  function addMainRow(){
    if(playCount >= MAX_PLAYS){
      alert("You have reached 25 plays in the main form.");
      return null;
    }
    playCount++;
    const rowIndex = playCount;
    const rowHTML = `
      <tr data-playIndex="${rowIndex}">
        <td>
          <button type="button" class="btnRemovePlay removeMainBtn" data-row="${rowIndex}">
            ${rowIndex}
          </button>
        </td>
        <td>
          <input type="text" class="form-control betNumber" />
        </td>
        <td class="gameMode">-</td>
        <td>
          <input type="number" class="form-control straight" />
        </td>
        <td>
          <input type="text" class="form-control box" />
        </td>
        <td>
          <input type="number" class="form-control combo" />
        </td>
        <td class="total">0.00</td>
      </tr>
    `;
    $("#tablaJugadas").append(rowHTML);
    return $("#tablaJugadas tr[data-playIndex='"+rowIndex+"']");
  }

  function renumberMainRows(){
    let i=0;
    $("#tablaJugadas tr").each(function(){
      i++;
      $(this).attr("data-playIndex", i);
      $(this).find(".removeMainBtn").attr("data-row", i).text(i);
    });
    playCount = i;
    storeFormState();
  }

  function recalcMainRow($row){
    const bn = $row.find(".betNumber").val().trim();
    const gm = determineGameMode(bn);
    $row.find(".gameMode").text(gm);

    const stVal = $row.find(".straight").val().trim();
    const bxVal = $row.find(".box").val().trim();
    const coVal = $row.find(".combo").val().trim();

    const rowTotal = calculateRowTotal(bn, gm, stVal, bxVal, coVal);
    $row.find(".total").text(rowTotal);
    calculateMainTotal();
  }

  // ----------------------------------------------------------------
  // [6] CALCULATE MAIN TOTAL
  // ----------------------------------------------------------------
  function calculateMainTotal(){
    let sum=0;
    $("#tablaJugadas tr").each(function(){
      const totalCell= $(this).find(".total").text();
      const val= parseFloat(totalCell)||0;
      sum+= val;
    });
    if(selectedDaysCount===0){
      sum=0;
    } else {
      sum = sum * selectedTracksCount * selectedDaysCount;
    }
    $("#totalJugadas").text( sum.toFixed(2) );
    storeFormState();
  }

  // ----------------------------------------------------------------
  // [7] DETERMINE GAME MODE
  // ----------------------------------------------------------------
  function determineGameMode(betNumber){
    if(!betNumber) return "-";

    const tracks = $(".track-checkbox:checked")
      .map(function(){return $(this).val();})
      .get();
    const isUSA = tracks.some(t => cutoffTimes.USA[t]);
    const isSD  = tracks.some(t => cutoffTimes["Santo Domingo"][t]);
    const includesVenezuela = tracks.includes("Venezuela");
    const includesHorses = tracks.includes("New York Horses");

    // 1) "NY Horses"
    if(includesHorses){
      return "NY Horses";
    }

    // 2) Single Action => 1 dígito, track de USA (except venezuela/horses)
    if(isUSA && !includesVenezuela && betNumber.length===1){
      return "Single Action";
    }

    // 3) Pale => 2 dígitos, - o x, 2 dígitos
    const paleRegex = /^(\d{2})(-|x)(\d{2})$/;
    if(paleRegex.test(betNumber)){
      if(includesVenezuela && isUSA) {
        return "Pale-Ven";
      }
      if(isSD && !isUSA){
        return "Pale-RD";
      }
      return "-";
    }

    const length = betNumber.length;
    if(length<2 || length>4) return "-";

    // 4) Venezuela => 2 dig + track USA
    if(length===2 && includesVenezuela && isUSA){
      return "Venezuela";
    }
    // 5) Pulito => 2 dig + track USA sin SD
    if(isUSA && !isSD && length===2){
      return "Pulito";
    }
    // 6) RD-Quiniela => 2 dig + track SD sin USA
    if(length===2 && isSD && !isUSA){
      return "RD-Quiniela";
    }
    // 7) 3 díg => pick 3
    if(length===3) return "Pick 3";
    // 8) 4 díg => win 4
    if(length===4) return "Win 4";

    return "-";
  }

  // ----------------------------------------------------------------
  // [8] CALCULATE ROW TOTAL
  // ----------------------------------------------------------------
  function calculateRowTotal(bn, gm, stVal, bxVal, coVal){
    if(!bn || gm==="-") return "0.00";
    const st = parseFloat(stVal) || 0;
    const combo = parseFloat(coVal)||0;

    // Pulito => st * #posiciones en box
    if(gm==="Pulito"){
      if(bxVal){
        const positions = bxVal.split(",").map(x=>x.trim()).filter(Boolean);
        return (st * positions.length).toFixed(2);
      }
      return "0.00";
    }

    // Single Action => st+box+combo
    if(gm==="Single Action"){
      const numericBox = parseFloat(bxVal)||0;
      return (st + numericBox + combo).toFixed(2);
    }

    // NY Horses => st+box+combo
    if(gm==="NY Horses"){
      const numericBox = parseFloat(bxVal)||0;
      return (st + numericBox + combo).toFixed(2);
    }

    // Venezuela, Pale-RD, Pale-Ven, RD-Quiniela => solo st
    if(["Venezuela","Pale-RD","Pale-Ven","RD-Quiniela"].includes(gm)){
      return st.toFixed(2);
    }

    // Win4 / Pick3 => combosCount
    if(gm==="Win 4" || gm==="Pick 3"){
      const numericBox = parseFloat(bxVal)||0;
      const combosCount = calcCombos(bn);
      let total = st + numericBox + combo*combosCount;
      return total.toFixed(2);
    }

    // default => st + box + combo
    const numericBox = parseFloat(bxVal)||0;
    return (st + numericBox + combo).toFixed(2);
  }

  function calcCombos(str){
    const freq = {};
    for(let c of str){
      freq[c] = (freq[c]||0)+1;
    }
    const factorial = n => n<=1 ? 1 : n*factorial(n-1);
    let denom=1;
    for(let k in freq){
      denom*= factorial(freq[k]);
    }
    return factorial(str.length)/denom;
  }

  // ----------------------------------------------------------------
  // [9] LOCALSTORAGE => store/load
  // ----------------------------------------------------------------
  function storeFormState(){
    const st = {
      selectedTracksCount,
      selectedDaysCount,
      dateVal: $("#fecha").val(),
      playCount,
      plays: []
    };
    $("#tablaJugadas tr").each(function(){
      const bn = $(this).find(".betNumber").val();
      const gm = $(this).find(".gameMode").text();
      const stv= $(this).find(".straight").val();
      const bxv= $(this).find(".box").val();
      const cov= $(this).find(".combo").val();
      const tot= $(this).find(".total").text();
      st.plays.push({
        betNumber: bn || "",
        gameMode: gm || "-",
        straight: stv || "",
        box: bxv || "",
        combo: cov || "",
        total: tot || "0.00"
      });
    });
    localStorage.setItem("formState", JSON.stringify(st));
  }

  function loadFormState(){
    const data=JSON.parse(localStorage.getItem("formState"));
    if(!data) return;
    $("#fecha").val(data.dateVal || "");
    selectedDaysCount= data.selectedDaysCount||0;
    selectedTracksCount= data.selectedTracksCount||1;
    playCount= data.playCount||0;

    $("#tablaJugadas").empty();
    let i=0;
    data.plays.forEach((p)=>{
      i++;
      const rowHTML = `
        <tr data-playIndex="${i}">
          <td>
            <button type="button" class="btnRemovePlay removeMainBtn" data-row="${i}">${i}</button>
          </td>
          <td>
            <input type="text" class="form-control betNumber" value="${p.betNumber||""}" />
          </td>
          <td class="gameMode">${p.gameMode||"-"}</td>
          <td>
            <input type="number" class="form-control straight" value="${p.straight||""}" />
          </td>
          <td>
            <input type="text" class="form-control box" value="${p.box||""}" />
          </td>
          <td>
            <input type="number" class="form-control combo" value="${p.combo||""}" />
          </td>
          <td class="total">${p.total||"0.00"}</td>
        </tr>
      `;
      $("#tablaJugadas").append(rowHTML);
    });
    playCount = i;
    recalcAllMainRows();
    calculateMainTotal();
    highlightDuplicatesInMain();
  }
  loadFormState();

  function recalcAllMainRows(){
    $("#tablaJugadas tr").each(function(){
      recalcMainRow($(this));
    });
  }

  // ----------------------------------------------------------------
  // [10] RESET FORM
  // ----------------------------------------------------------------
  $("#resetForm").click(function(){
    if(confirm("Are you sure you want to reset the form?")){
      resetForm();
    }
  });
  function resetForm(){
    $("#lotteryForm")[0].reset();
    $("#tablaJugadas").empty();
    playCount=0;
    selectedTracksCount=0;
    selectedDaysCount=0;
    window.ticketImageDataUrl=null;
    $("#totalJugadas").text("0.00");
    localStorage.removeItem("formState");
    showCutoffTimes();
    disableTracksByTime();
    autoSelectNYTrack();
  }

  // ----------------------------------------------------------------
  // [11] GENERATE TICKET
  // ----------------------------------------------------------------
  $("#generarTicket").click(function(){
    doGenerateTicket();
  });

  function doGenerateTicket(){
    const dateVal=$("#fecha").val()||"";
    if(!dateVal){
      alert("Please select at least one date.");
      return;
    }
    $("#ticketFecha").text(dateVal);

    const chosenTracks = $(".track-checkbox:checked")
      .map(function(){return $(this).val();})
      .get();
    if(chosenTracks.length===0){
      alert("Please select at least one track.");
      return;
    }
    $("#ticketTracks").text(chosenTracks.join(", "));

    // Ver cutoff si elige HOY
    const arrDates = dateVal.split(", ");
    const today = dayjs().startOf("day");
    for(let ds of arrDates){
      const [mm,dd,yy] = ds.split("-").map(Number);
      const picked = dayjs(new Date(yy, mm-1, dd)).startOf("day");
      if(picked.isSame(today,"day")){
        const now=dayjs();
        for(let t of chosenTracks){
          if(t==="Venezuela") continue;
          const raw=getTrackCutoff(t);
          if(raw){
            let co= dayjs(raw,"HH:mm");
            let cf= co.isAfter(dayjs("21:30","HH:mm"))? dayjs("22:00","HH:mm"): co.subtract(10,"minute");
            if(now.isSame(cf)||now.isAfter(cf)){
              alert(`Track "${t}" is closed for today.`);
              return;
            }
          }
        }
      }
    }

    // Validar filas
    const rows = $("#tablaJugadas tr");
    let valid=true;
    const errors=[];
    rows.each(function(){
      $(this).find(".betNumber,.straight,.box,.combo,.gameMode").removeClass("error-field");
    });

    rows.each(function(){
      const rowIndex = parseInt($(this).attr("data-playIndex"));
      const bn = $(this).find(".betNumber").val().trim();
      const gm = $(this).find(".gameMode").text();
      const st = parseFloat($(this).find(".straight").val().trim()||"0");
      const bx = parseFloat($(this).find(".box").val().trim()||"0");
      const co = parseFloat($(this).find(".combo").val().trim()||"0");

      let errorHere = false;
      if(!bn){
        errorHere=true;
        errors.push(rowIndex);
        $(this).find(".betNumber").addClass("error-field");
      }
      // Brooklyn/Front => BN=3
      if(hasBrooklynOrFront(chosenTracks) && bn.length!==3){
        errorHere=true;
        errors.push(rowIndex);
        $(this).find(".betNumber").addClass("error-field");
      }
      if(gm==="-"){
        errorHere=true;
        errors.push(rowIndex);
        $(this).find(".gameMode").addClass("error-field");
      }

      // Requerir Straight>0 en: Venezuela, Pale-Ven, Pulito, RD-Quiniela, Pale-RD
      if(["Venezuela","Pale-Ven","Pulito","RD-Quiniela","Pale-RD"].includes(gm)){
        if(st<=0){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight").addClass("error-field");
        }
      }

      // Requerir al menos algo en Win4 / Pick3 => st, bx o co > 0
      if(["Win 4","Pick 3"].includes(gm)){
        if(st<=0 && bx<=0 && co<=0){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight,.box,.combo").addClass("error-field");
        }
      }

      // Single Action => st+bx+co > 0
      if(gm==="Single Action"){
        if(st<=0 && bx<=0 && co<=0){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight,.box,.combo").addClass("error-field");
        }
      }
      // NY Horses => st+bx+co > 0
      if(gm==="NY Horses"){
        if(st<=0 && bx<=0 && co<=0){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight,.box,.combo").addClass("error-field");
        }
      }

      // LIMITES
      if(gm==="Win 4"){
        if(st>6){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight").addClass("error-field");
        }
        if(co>6){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".combo").addClass("error-field");
        }
        if(bx>40){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".box").addClass("error-field");
        }
      }
      if(gm==="Pick 3"){
        if(st>35){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight").addClass("error-field");
        }
        if(co>35){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".combo").addClass("error-field");
        }
        if(bx>100){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".box").addClass("error-field");
        }
      }
      if(gm==="Venezuela"){
        if(st>100){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight").addClass("error-field");
        }
      }
      if(gm==="Pulito"){
        if(st>100){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight").addClass("error-field");
        }
      }

      if(errorHere) valid=false;
    });

    if(!valid){
      const uniqueErr=[...new Set(errors)].join(", ");
      alert(`Some plays have errors or exceed limits (row(s): ${uniqueErr}). Please fix them.`);
      return;
    }

    // Llenar la tabla del ticket
    $("#ticketJugadas").empty();
    rows.each(function(){
      const rowIndex=$(this).attr("data-playIndex");
      const bn  = $(this).find(".betNumber").val().trim();
      const gm  = $(this).find(".gameMode").text();
      let stVal = $(this).find(".straight").val().trim() || "0.00";
      let bxVal = $(this).find(".box").val().trim() || "-";
      let coVal = $(this).find(".combo").val().trim() || "0.00";
      let totVal= $(this).find(".total").text() || "0.00";

      const rowHTML=`
        <tr>
          <td>${rowIndex}</td>
          <td>${bn}</td>
          <td>${gm}</td>
          <td>${parseFloat(stVal).toFixed(2)}</td>
          <td>${bxVal==="-"?"-":bxVal}</td>
          <td>${parseFloat(coVal).toFixed(2)}</td>
          <td>${parseFloat(totVal).toFixed(2)}</td>
        </tr>
      `;
      $("#ticketJugadas").append(rowHTML);
    });
    $("#ticketTotal").text($("#totalJugadas").text());
    $("#ticketTransaccion").text(dayjs().format("MM/DD/YYYY hh:mm A"));
    $("#numeroTicket").text("(Not assigned yet)");
    $("#qrcode").empty();

    const ticketModal=new bootstrap.Modal(document.getElementById("ticketModal"));
    $("#editButton").removeClass("d-none");
    $("#shareTicket").addClass("d-none");
    $("#confirmarTicket").prop("disabled",false);
    fixTicketLayoutForMobile();
    ticketModal.show();
    storeFormState();
  }

  $("#confirmarTicket").click(function(){
    $(this).prop("disabled",true);
    $("#editButton").addClass("d-none");

    const uniqueTicket = generateUniqueTicketNumber();
    $("#numeroTicket").text(uniqueTicket);
    transactionDateTime = dayjs().format("MM/DD/YYYY hh:mm A");
    $("#ticketTransaccion").text(transactionDateTime);

    // Generar QR
    $("#qrcode").empty();
    new QRCode(document.getElementById("qrcode"),{
      text: uniqueTicket,
      width:128,
      height:128
    });

    $("#shareTicket").removeClass("d-none");

    const ticketElement=document.getElementById("preTicket");
    const originalStyles={
      width:$(ticketElement).css("width"),
      height:$(ticketElement).css("height"),
      maxHeight:$(ticketElement).css("max-height"),
      overflowY:$(ticketElement).css("overflow-y")
    };
    $(ticketElement).css({
      width:"auto",
      height:"auto",
      maxHeight:"none",
      overflowY:"visible"
    });

    setTimeout(()=>{
      // *** scale=2, JPEG ***
      html2canvas(ticketElement,{scale:2})
      .then(canvas=>{
        const dataUrl=canvas.toDataURL("image/jpeg",0.8);
        window.ticketImageDataUrl=dataUrl;

        // auto download => ticket_{uniqueTicket}.jpg
        const link=document.createElement("a");
        link.href=dataUrl;
        link.download=`ticket_${uniqueTicket}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        alert("Your ticket image was downloaded successfully (JPEG).");

        saveBetDataToSheetDB(uniqueTicket, success=>{
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
    const ticketModal=bootstrap.Modal.getInstance(document.getElementById("ticketModal"));
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
        const file=new File([blob],"ticket.jpg",{type:"image/jpeg"});
        if(navigator.canShare({files:[file]})){
          await navigator.share({files:[file], title:"Ticket", text:"Sharing Ticket"});
        } else {
          alert("Your browser does not support file sharing. Please share the downloaded image manually.");
        }
      } catch(err){
        console.error(err);
        alert("Could not share the ticket image. Please try manually.");
      }
    } else {
      alert("Your browser doesn't support the Web Share API with files. Please share manually.");
    }
  });

  function generateUniqueTicketNumber(){
    return Math.floor(10000000 + Math.random()*90000000).toString();
  }

  function fixTicketLayoutForMobile(){
    $("#preTicket table, #preTicket th, #preTicket td").css("white-space","nowrap");
    $("#preTicket").css("overflow-x","auto");
  }

  function saveBetDataToSheetDB(uniqueTicket, callback){
    const dateVal = $("#fecha").val()||"";
    const chosenTracks = $(".track-checkbox:checked")
      .map(function(){return $(this).val();})
      .get();
    const joinedTracks = chosenTracks.join(", ");
    const nowISO=dayjs().toISOString();
    let betData=[];

    $("#tablaJugadas tr").each(function(){
      const rowIndex=$(this).attr("data-playIndex");
      const bn = $(this).find(".betNumber").val();
      const gm = $(this).find(".gameMode").text();
      const st = $(this).find(".straight").val();
      const bx = $(this).find(".box").val();
      const co = $(this).find(".combo").val();
      const tot= $(this).find(".total").text();

      if(gm!=="-"){
        betData.push({
          "Ticket Number": uniqueTicket,
          "Transaction DateTime": transactionDateTime,
          "Bet Dates": dateVal,
          "Tracks": joinedTracks,
          "Bet Number": bn||"",
          "Game Mode": gm,
          "Straight ($)": st||"",
          "Box ($)": bx||"",
          "Combo ($)": co||"",
          "Total ($)": tot||"0.00",
          "Row Number": rowIndex,
          "Timestamp": nowISO
        });
      }
    });

    fetch(SHEETDB_API_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ data: betData })
    })
    .then(r=>{
      if(!r.ok) throw new Error(`SheetDB error: ${r.status}`);
      return r.json();
    })
    .then(d=>{
      console.log("Data stored in SheetDB:", d);
      callback(true);
    })
    .catch(e=>{
      console.error(e);
      callback(false);
    });
  }

  function getTrackCutoff(tn){
    for(let region in cutoffTimes){
      if(cutoffTimes[region][tn]){
        return cutoffTimes[region][tn];
      }
    }
    return null;
  }

  function hasBrooklynOrFront(tracks){
    const bfSet = new Set(["Brooklyn Midday","Brooklyn Evening","Front Midday","Front Evening"]);
    return tracks.some(t=> bfSet.has(t));
  }

  function userChoseToday(){
    const val=$("#fecha").val();
    if(!val) return false;
    const arr=val.split(", ");
    const today=dayjs().startOf("day");
    for(let ds of arr){
      const [mm,dd,yy]=ds.split("-").map(Number);
      const picked=dayjs(new Date(yy,mm-1,dd)).startOf("day");
      if(picked.isSame(today,"day")) return true;
    }
    return false;
  }

  function disableTracksByTime(){
    if(!userChoseToday()){
      enableAllTracks();
      return;
    }
    const now=dayjs();
    $(".track-checkbox").each(function(){
      const val=$(this).val();
      if(val==="Venezuela")return;
      const raw=getTrackCutoff(val);
      if(raw){
        let co=dayjs(raw,"HH:mm");
        let cf= co.isAfter(dayjs("21:30","HH:mm"))? dayjs("22:00","HH:mm"): co.subtract(10,"minute");
        if(now.isSame(cf)||now.isAfter(cf)){
          $(this).prop("checked",false).prop("disabled",true);
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

  function showCutoffTimes(){
    $(".cutoff-time").each(function(){
      const track=$(this).data("track");
      if(track==="Venezuela")return;
      let raw="";
      if(cutoffTimes.USA[track]) raw=cutoffTimes.USA[track];
      else if(cutoffTimes["Santo Domingo"][track]) raw=cutoffTimes["Santo Domingo"][track];
      else if(cutoffTimes.Venezuela[track]) raw=cutoffTimes.Venezuela[track];

      if(raw){
        let co=dayjs(raw,"HH:mm");
        let cf=co.isAfter(dayjs("21:30","HH:mm")) ? dayjs("22:00","HH:mm") : co.subtract(10,"minute");
        const hh=cf.format("HH");
        const mm=cf.format("mm");
        $(this).text(`${hh}:${mm}`);
      }
    });
  }

  showCutoffTimes();
  disableTracksByTime();
  setInterval(disableTracksByTime,60000);

  // AUTO-SELECT NY
  autoSelectNYTrack();
  function autoSelectNYTrack(){
    const anyChecked = $(".track-checkbox:checked").length>0;
    if(anyChecked) return;
    const now=dayjs();
    let middayCutoff= dayjs().hour(14).minute(20);
    if(now.isBefore(middayCutoff)){
      $("#trackNYMidDay").prop("checked",true);
    } else {
      $("#trackNYEvening").prop("checked",true);
    }
    $(".track-checkbox").trigger("change");
  }

  // Duplicates highlight
  function highlightDuplicatesInMain(){
    $("#tablaJugadas tr").find(".betNumber").removeClass("duplicado");
    let counts={};
    $("#tablaJugadas tr").each(function(){
      const bn=$(this).find(".betNumber").val().trim();
      if(!bn) return;
      counts[bn]=(counts[bn]||0)+1;
    });
    $("#tablaJugadas tr").each(function(){
      const bn=$(this).find(".betNumber").val().trim();
      if(counts[bn]>1){
        $(this).find(".betNumber").addClass("duplicado");
      }
    });
  }

  // ----------------------------------------------------------------
  // [12] WIZARD
  // ----------------------------------------------------------------
  const wizardModal=new bootstrap.Modal(document.getElementById("wizardModal"));

  $("#wizardButton").click(function(){
    resetWizard();
    wizardModal.show();
  });

  function resetWizard(){
    wizardCount=0;
    $("#wizardTableBody").empty();
    lockedFields.straight=false;
    lockedFields.box=false;
    lockedFields.combo=false;
    $("#lockStraight").html(`<i class="bi bi-unlock"></i>`);
    $("#lockBox").html(`<i class="bi bi-unlock"></i>`);
    $("#lockCombo").html(`<i class="bi bi-unlock"></i>`);
    $("#wizardBetNumber").val("");
    $("#wizardStraight").val("");
    $("#wizardBox").val("");
    $("#wizardCombo").val("");
    $("#qpGameMode").val("Pick 3");
    $("#qpCount").val("5");
    $("#rdFirstNumber").val("");
    $("#rdLastNumber").val("");
  }

  $(".lockBtn").click(function(){
    const field=$(this).data("field");
    lockedFields[field]=!lockedFields[field];
    if(lockedFields[field]){
      $(this).html(`<i class="bi bi-lock-fill"></i>`);
    } else {
      $(this).html(`<i class="bi bi-unlock"></i>`);
    }
  });

  $("#wizardAddNext").click(function(){
    const bn=$("#wizardBetNumber").val().trim();
    const gm=determineGameMode(bn);
    if(gm==="-"){
      alert(`Cannot determine game mode for "${bn}". Check tracks or length/format.`);
      return;
    }
    let stVal = lockedFields.straight? $("#wizardStraight").val().trim() : $("#wizardStraight").val().trim();
    let bxVal = lockedFields.box? $("#wizardBox").val().trim() : $("#wizardBox").val().trim();
    let coVal = lockedFields.combo? $("#wizardCombo").val().trim() : $("#wizardCombo").val().trim();

    const rowT= calculateRowTotal(bn, gm, stVal, bxVal, coVal);
    addWizardRow(bn, gm, stVal, bxVal, coVal, rowT);

    if(!lockedFields.straight) $("#wizardStraight").val("");
    if(!lockedFields.box) $("#wizardBox").val("");
    if(!lockedFields.combo) $("#wizardCombo").val("");
    $("#wizardBetNumber").val("").focus();

    highlightDuplicatesInWizard();
  });

  function addWizardRow(bn,gm,stVal,bxVal,coVal,total){
    wizardCount++;
    const i=wizardCount;
    const rowHTML=`
      <tr data-wizardIndex="${i}">
        <td>
          <button type="button" class="removeWizardBtn btnRemovePlay" data-row="${i}">${i}</button>
        </td>
        <td>${bn}</td>
        <td>${gm}</td>
        <td>${stVal||"-"}</td>
        <td>${bxVal||"-"}</td>
        <td>${coVal||"-"}</td>
        <td>${parseFloat(total||0).toFixed(2)}</td>
      </tr>
    `;
    $("#wizardTableBody").append(rowHTML);
  }

  $("#wizardTableBody").on("click",".removeWizardBtn",function(){
    $(this).closest("tr").remove();
    renumberWizard();
    highlightDuplicatesInWizard();
  });

  function renumberWizard(){
    let i=0;
    $("#wizardTableBody tr").each(function(){
      i++;
      $(this).attr("data-wizardIndex",i);
      $(this).find(".removeWizardBtn").attr("data-row",i).text(i);
    });
    wizardCount=i;
  }

  $("#btnGenerateQuickPick").click(function(){
    const gm=$("#qpGameMode").val();
    const countVal= parseInt($("#qpCount").val())||1;
    if(countVal<1||countVal>25){
      alert("Please enter a count between 1 and 25.");
      return;
    }
    const stVal= lockedFields.straight? $("#wizardStraight").val().trim(): $("#wizardStraight").val().trim();
    const bxVal= lockedFields.box? $("#wizardBox").val().trim(): $("#wizardBox").val().trim();
    const coVal= lockedFields.combo? $("#wizardCombo").val().trim(): $("#wizardCombo").val().trim();

    for(let i=0;i<countVal;i++){
      let bn = generateRandomNumberForMode(gm);
      bn= padNumberForMode(bn, gm);
      let rowT= calculateRowTotal(bn, gm, stVal, bxVal, coVal);
      addWizardRow(bn, gm, stVal, bxVal, coVal, rowT);
    }
    highlightDuplicatesInWizard();
  });

  function generateRandomNumberForMode(mode){
    if(mode==="NY Horses"){
      const length = Math.floor(Math.random()*4)+1;
      const maxVal = Math.pow(10,length)-1;
      return Math.floor(Math.random()*(maxVal+1));
    }
    if(mode==="Single Action"){
      return Math.floor(Math.random()*10);
    }
    if(mode==="Win 4"||mode==="Pale-Ven"||mode==="Pale-RD"){
      return Math.floor(Math.random()*10000);
    }
    if(mode==="Pick 3"){
      return Math.floor(Math.random()*1000);
    }
    if(mode==="Venezuela"||mode==="Pulito"||mode==="RD-Quiniela"){
      return Math.floor(Math.random()*100);
    }
    return Math.floor(Math.random()*1000);
  }
  function padNumberForMode(num, mode){
    if(mode==="NY Horses" || mode==="Single Action"){
      return num.toString();
    }
    if(mode==="Pale-Ven"||mode==="Pale-RD"||mode==="Win 4"){
      let s=num.toString();
      while(s.length<4) s="0"+s;
      return s;
    }
    if(mode==="Pulito"||mode==="RD-Quiniela"||mode==="Venezuela"){
      let s=num.toString();
      while(s.length<2) s="0"+s;
      return s;
    }
    if(mode==="Pick 3"){
      let s=num.toString();
      while(s.length<3) s="0"+s;
      return s;
    }
    let s=num.toString();
    while(s.length<3) s="0"+s;
    return s;
  }

  $("#btnGenerateRoundDown").click(function(){
    const firstNum=$("#rdFirstNumber").val().trim();
    const lastNum =$("#rdLastNumber").val().trim();
    if(!firstNum||!lastNum){
      alert("Please enter both first and last number for Round Down.");
      return;
    }
    if(firstNum.length!==lastNum.length){
      alert("First/Last must have the same length (2,3, or 4 digits).");
      return;
    }
    let start = parseInt(firstNum,10);
    let end   = parseInt(lastNum,10);
    if(isNaN(start)||isNaN(end)){
      alert("Invalid numeric range for Round Down.");
      return;
    }
    if(start> end){
      [start,end]=[end,start];
    }
    const stVal= lockedFields.straight? $("#wizardStraight").val().trim(): $("#wizardStraight").val().trim();
    const bxVal= lockedFields.box? $("#wizardBox").val().trim(): $("#wizardBox").val().trim();
    const coVal= lockedFields.combo? $("#wizardCombo").val().trim(): $("#wizardCombo").val().trim();

    for(let i=start;i<=end;i++){
      let bn=i.toString().padStart(firstNum.length,"0");
      let gm=determineGameMode(bn);
      if(gm==="-") continue;
      const rowT= calculateRowTotal(bn, gm, stVal, bxVal, coVal);
      addWizardRow(bn, gm, stVal, bxVal, coVal, rowT);
    }
    highlightDuplicatesInWizard();
  });

  $("#btnPermute").click(function(){
    permuteWizardBetNumbers();
  });
  function permuteWizardBetNumbers(){
    const rows = $("#wizardTableBody tr");
    if(rows.length===0){
      alert("No plays in the wizard table.");
      return;
    }
    let allDigits=[];
    let lengths=[];
    rows.each(function(){
      const bn=$(this).find("td").eq(1).text().trim();
      lengths.push(bn.length);
      for(let c of bn) allDigits.push(c);
    });
    if(allDigits.length===0){
      alert("No digits found to permute.");
      return;
    }
    // shuffle
    for(let i=allDigits.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [allDigits[i],allDigits[j]]=[allDigits[j],allDigits[i]];
    }
    let idx=0;
    rows.each(function(i){
      const needed= lengths[i];
      const subset= allDigits.slice(idx, idx+needed);
      idx+= needed;
      const newBN= subset.join("");
      const gm= determineGameMode(newBN);
      const stTd = $(this).find("td").eq(3).text().trim();
      const bxTd = $(this).find("td").eq(4).text().trim();
      const coTd = $(this).find("td").eq(5).text().trim();

      const newTotal = calculateRowTotal(newBN, gm, stTd==="-"?"0":stTd, bxTd==="-"?"0":bxTd, coTd==="-"?"0":coTd);
      $(this).find("td").eq(1).text(newBN);
      $(this).find("td").eq(2).text(gm);
      $(this).find("td").eq(6).text(parseFloat(newTotal).toFixed(2));
    });
    highlightDuplicatesInWizard();
  }

  $("#wizardAddAllToMain").click(function(){
    const wizardRows=$("#wizardTableBody tr");
    if(wizardRows.length===0){
      alert("No plays in the wizard table.");
      return;
    }
    wizardRows.each(function(){
      if(playCount>=MAX_PLAYS){
        alert("Reached 25 plays in the main form. Stopping import.");
        return false;
      }
      const tds=$(this).find("td");
      const bn=tds.eq(1).text();
      const gm=tds.eq(2).text();
      const stVal=(tds.eq(3).text()==="-"?"":tds.eq(3).text());
      const bxVal=(tds.eq(4).text()==="-"?"":tds.eq(4).text());
      const coVal=(tds.eq(5).text()==="-"?"":tds.eq(5).text());
      const total=tds.eq(6).text();

      if(playCount<MAX_PLAYS){
        playCount++;
        const rowIndex=playCount;
        const rowHTML=`
          <tr data-playIndex="${rowIndex}">
            <td>
              <button type="button" class="btnRemovePlay removeMainBtn" data-row="${rowIndex}">
                ${rowIndex}
              </button>
            </td>
            <td>
              <input type="text" class="form-control betNumber" value="${bn}" />
            </td>
            <td class="gameMode">${gm}</td>
            <td>
              <input type="number" class="form-control straight" value="${stVal}" />
            </td>
            <td>
              <input type="text" class="form-control box" value="${bxVal}" />
            </td>
            <td>
              <input type="number" class="form-control combo" value="${coVal}" />
            </td>
            <td class="total">${parseFloat(total||0).toFixed(2)}</td>
          </tr>
        `;
        $("#tablaJugadas").append(rowHTML);
      }
    });
    $("#wizardTableBody").empty();
    wizardCount=0;
    recalcAllMainRows();
    calculateMainTotal();
    highlightDuplicatesInMain();
    storeFormState();
  });

  $("#wizardGenerateTicket").click(function(){
    $("#wizardAddAllToMain").trigger("click");
    wizardModal.hide();
    doGenerateTicket();
  });

  $("#wizardEditMainForm").click(function(){
    wizardModal.hide();
  });

  function highlightDuplicatesInWizard(){
    $("#wizardTableBody tr").find("td:nth-child(2)").removeClass("duplicado");
    let counts={};
    $("#wizardTableBody tr").each(function(){
      const bn=$(this).find("td").eq(1).text().trim();
      if(!bn)return;
      counts[bn]=(counts[bn]||0)+1;
    });
    $("#wizardTableBody tr").each(function(){
      const bn=$(this).find("td").eq(1).text().trim();
      if(counts[bn]>1){
        $(this).find("td").eq(1).addClass("duplicado");
      }
    });
  }

  // ----------------------------------------------------------------
  // [13] INTRO.JS TUTORIAL (3 IDIOMAS, PASOS EXTENSOS)
  // ----------------------------------------------------------------
  const tutorialStepsEN = [
    {
      element: '#fecha',
      intro: 'Select one or multiple betting dates. By default, today is chosen.',
    },
    {
      element: '#tracksAccordion',
      intro: 'Expand “USA” or “Santo Domingo” to pick your tracks. Some will disable after cutoff time.'
    },
    {
      intro: 'If you pick “Venezuela,” combine it with a USA track. “NY Horses” => 1–4 digits for that mode.'
    },
    {
      element: '#jugadasTable',
      intro: 'Each row has a Bet Number, automatically detecting the mode (Pulito, Win4, etc.). Then put Straight/Box/Combo.'
    },
    {
      element: '#agregarJugada',
      intro: 'Use “Add Play” for a new row. You can remove or reset if needed.'
    },
    {
      intro: 'Pulito => 2 digits (USA). Venezuela => 2 digits (USA+Venezuela). Single => 1 digit (USA normal).'
    },
    {
      element: '#wizardButton',
      intro: 'Wizard => Quick Entry: random picks, Round Down, combos, etc.'
    },
    {
      intro: 'Inside Wizard: lock Straight/Box/Combo, type Bet Number, do Quick Pick, Round Down, Permute, etc.'
    },
    {
      element: '#generarTicket',
      intro: 'When ready, “Generate Ticket” => see preview.'
    },
    {
      element: '#ticketModal',
      intro: 'Preview shows your plays, total, QR code. “Edit” or confirm => unique ticket #. Downloads image.'
    },
    {
      intro: 'You can share if your browser supports Web Share. That’s the entire flow.'
    }
  ];

  const tutorialStepsES = [
    {
      element: '#fecha',
      intro: 'Seleccione una o varias fechas. “Hoy” por defecto.'
    },
    {
      element: '#tracksAccordion',
      intro: 'Expanda “USA” o “Santo Domingo” para elegir tracks. Algunos se cierran tras cutoff.'
    },
    {
      intro: 'Si marca “Venezuela,” use un track USA. “NY Horses” => 1–4 dígitos.'
    },
    {
      element: '#jugadasTable',
      intro: 'Cada fila (Bet Number) => Pulito, Win4, etc. Ingrese Straight/Box/Combo.'
    },
    {
      element: '#agregarJugada',
      intro: 'Agregue jugadas con “Add Play.” Puede remover o resetear.'
    },
    {
      intro: 'Pulito => 2 dígitos + track USA. Venezuela => 2 dígitos + track “Venezuela”+USA. Single => 1 dígito (USA).'
    },
    {
      element: '#wizardButton',
      intro: 'Wizard: Ventana extra para Quick Picks, Round Down, combos, etc.'
    },
    {
      intro: 'Dentro del Wizard: “lock” Straight/Box/Combo, Quick Pick, Round Down, Permute.'
    },
    {
      element: '#generarTicket',
      intro: 'Cuando termine, “Generate Ticket” => vista previa.'
    },
    {
      element: '#ticketModal',
      intro: 'Vista previa: jugadas, total, QR. Edite o confirme => # único. Descarga imagen.'
    },
    {
      intro: 'Puede compartir si su navegador lo soporta. ¡Listo!'
    }
  ];

  const tutorialStepsHT = [
    {
      element: '#fecha',
      intro: 'Chwazi youn oswa plizyè dat pou parye. “Jodia” se default.'
    },
    {
      element: '#tracksAccordion',
      intro: 'Louvri “USA” oswa “Santo Domingo” pou chwazi track. Gen ki fèmen apre cutoff.'
    },
    {
      intro: 'Si ou mete “Venezuela,” bezwen track USA. “NY Horses” => 1–4 chif.'
    },
    {
      element: '#jugadasTable',
      intro: 'Chak ranje gen Bet Number => Pulito, Pick3, Win4, etc. Mete Straight/Box/Combo.'
    },
    {
      element: '#agregarJugada',
      intro: 'Klike “Add Play” pou ajoute ranje. Ou ka retire oswa reset.'
    },
    {
      intro: 'Pulito => 2 chif + track USA. Venezuela => 2 chif + track Vzla+USA. Single => 1 chif, track USA.'
    },
    {
      element: '#wizardButton',
      intro: 'Wizard: Fenèt Quick Entry pou picks, Round Down, combos, etc.'
    },
    {
      intro: 'Anndan Wizard la: lock Straight/Box/Combo, Quick Pick, Round Down, Permute.'
    },
    {
      element: '#generarTicket',
      intro: 'Lè w fini, “Generate Ticket” => preview.'
    },
    {
      element: '#ticketModal',
      intro: 'Preview: tout parye yo, total, QR. Ou ka edite oswa konfime => # inik. Telechaje imaj.'
    },
    {
      intro: 'Ou ka pataje si navigatè a sipòte. Se pwosesis la!'
    }
  ];

  function startTutorial(lang){
    let steps = tutorialStepsEN;
    let nextLabel='Next', prevLabel='Back', skipLabel='Skip', doneLabel='Done';

    if(lang==='es'){
      steps = tutorialStepsES;
      nextLabel='Siguiente'; prevLabel='Atrás'; skipLabel='Omitir'; doneLabel='Listo';
    } else if(lang==='ht'){
      steps = tutorialStepsHT;
      nextLabel='Next'; prevLabel='Back'; skipLabel='Skip'; doneLabel='Ok';
    }

    introJs().setOptions({
      steps,
      showStepNumbers:true,
      showProgress:false,
      exitOnOverlayClick:true,
      scrollToElement:false,
      nextLabel,
      prevLabel,
      skipLabel,
      doneLabel
    }).start();
  }

  $("#helpEnglish").click(()=>startTutorial('en'));
  $("#helpSpanish").click(()=>startTutorial('es'));
  $("#helpCreole").click(()=>startTutorial('ht'));


  // ----------------------------------------------------------------
  // [14] MANUAL => MOSTRAR EN LA MISMA PÁGINA (SIN location.href)
  // ----------------------------------------------------------------
  $("#manualEnglishBtn").click(function(){
    $("#manualEnglishText").removeClass("d-none");
    $("#manualSpanishText").addClass("d-none");
    $("#manualCreoleText").addClass("d-none");
  });
  $("#manualSpanishBtn").click(function(){
    $("#manualEnglishText").addClass("d-none");
    $("#manualSpanishText").removeClass("d-none");
    $("#manualCreoleText").addClass("d-none");
  });
  $("#manualCreoleBtn").click(function(){
    $("#manualEnglishText").addClass("d-none");
    $("#manualSpanishText").addClass("d-none");
    $("#manualCreoleText").removeClass("d-none");
  });

}); // fin document.ready
