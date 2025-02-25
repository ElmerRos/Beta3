 const SHEETDB_API_URL = 'https://sheetdb.io/api/v1/bl57zyh73b0ev';

$(document).ready(function() {
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

  // =========================================================
  // CUTOFF TIMES
  // =========================================================
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

  // =========================================================
  // INIT FLATPICKR (Forzar fecha de hoy en el input)
  // =========================================================
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
      // Forzamos la fecha de hoy en el campo si no hay nada
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

  // =========================================================
  // TRACK CHECKBOXES
  // =========================================================
  $(".track-checkbox").change(function(){
    const arr = $(".track-checkbox:checked")
      .map(function(){return $(this).val();})
      .get();
    selectedTracksCount = arr.filter(x => x !== "Venezuela").length || 1;
    calculateMainTotal();
    disableTracksByTime();
  });

  // =========================================================
  // MAIN TABLE => Add, Remove
  // =========================================================
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

  // =========================================================
  // CALCULATE MAIN TOTAL
  // =========================================================
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

  // =========================================================
  // DETERMINE GAME MODE (Reordenado para “Venezuela” vs “Pulito”)
  // =========================================================
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

    // 2) Single Action => 1 dígito, track de USA (excepto Venezuela y Horses)
    if(isUSA && !includesVenezuela && betNumber.length===1){
      return "Single Action";
    }

    // 3) Pale => 2 dígitos, - o x, 2 dígitos
    const paleRegex = /^(\d{2})(-|x)(\d{2})$/;
    if( paleRegex.test(betNumber) ){
      if(includesVenezuela && isUSA) {
        return "Pale-Ven";
      }
      if(isSD && !isUSA){
        return "Pale-RD";
      }
      return "-";
    }

    // 4) Chequeo de longitud
    const length = betNumber.length;
    if(length<2 || length>4) return "-";

    // 5) Venezuela => 2 dígitos + (Venezuela + track USA)
    if(length===2 && includesVenezuela && isUSA){
      return "Venezuela";
    }

    // 6) Pulito => 2 dígitos, track USA sin SD
    if(isUSA && !isSD && length===2){
      return "Pulito";
    }

    // 7) RD-Quiniela => 2 dígitos + track SD (sin USA)
    if(length===2 && isSD && !isUSA){
      return "RD-Quiniela";
    }

    // 8) 3 dígitos => Pick 3
    if(length===3){
      return "Pick 3";
    }

    // 9) 4 dígitos => Win 4
    if(length===4){
      return "Win 4";
    }

    return "-";
  }

  // =========================================================
  // CALCULATE ROW TOTAL
  // =========================================================
  function calculateRowTotal(bn, gm, stVal, bxVal, coVal){
    if(!bn || gm==="-") return "0.00";
    const st = parseFloat(stVal) || 0;
    const combo = parseFloat(coVal)||0;

    // Pulito => multiplicar st por la cantidad de posiciones (boxVal)
    if(gm==="Pulito"){
      if(bxVal){
        const positions = bxVal.split(",").map(x=>x.trim()).filter(Boolean);
        return (st * positions.length).toFixed(2);
      }
      return "0.00";
    }

    // Single Action => 1 dígito (sum st+box+combo)
    if(gm==="Single Action"){
      const numericBox = parseFloat(bxVal)||0;
      return (st + numericBox + combo).toFixed(2);
    }

    // NY Horses => sum st+box+combo
    if(gm==="NY Horses"){
      const numericBox = parseFloat(bxVal)||0;
      return (st + numericBox + combo).toFixed(2);
    }

    // Venezuela, Pale-RD, Pale-Ven, RD-Quiniela => st
    if(gm==="Venezuela" || gm==="Pale-RD" || gm==="Pale-Ven" || gm==="RD-Quiniela"){
      return st.toFixed(2);
    }

    // Win 4, Pick 3 => combosCount
    if(gm==="Win 4" || gm==="Pick 3"){
      const numericBox = parseFloat(bxVal)||0;
      const combosCount = calcCombos(bn);
      let total = st + numericBox + combo*combosCount;
      return total.toFixed(2);
    }

    // Caso default
    const numericBox = parseFloat(bxVal)||0;
    let totalD = st + numericBox + combo;
    return totalD.toFixed(2);
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

  // =========================================================
  // LOCALSTORAGE => store / load
  // =========================================================
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

  function recalcAllMainRows(){
    $("#tablaJugadas tr").each(function(){
      recalcMainRow($(this));
    });
  }
  loadFormState();

  // =========================================================
  // RESET FORM
  // =========================================================
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

  // =========================================================
  // GENERATE TICKET
  // =========================================================
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

    // Ver cutoff si eligió HOY
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

      // ===========================================================
      // LIMITES DE APUESTA
      // ===========================================================
      // Win 4 => st<=6, co<=6, bx<=40
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
      // Pick 3 => st<=35, co<=35, bx<=100
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
      // Venezuela y Pulito => st<=100
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
      // Otras => sin límite adicional

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
      html2canvas(ticketElement,{scale:4})
      .then(canvas=>{
        const dataUrl=canvas.toDataURL("image/png");
        window.ticketImageDataUrl=dataUrl;

        // Descarga automática
        const link=document.createElement("a");
        link.href=dataUrl;
        link.download=`ticket_${uniqueTicket}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        alert("Your ticket image was downloaded successfully.");

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
        const file=new File([blob],"ticket.png",{type:"image/png"});
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
        let cf= co.isAfter(dayjs("21:30","HH:mm"))?dayjs("22:00","HH:mm"): co.subtract(10,"minute");
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

  // AUTO-SELECT NY TRACK
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

  // DUPLICATES en main table
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

  // =========================================================
  // WIZARD (Ventana)
  // =========================================================
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
    // "NY Horses" => 1..4 dígitos
    if(mode==="NY Horses"){
      const length = Math.floor(Math.random()*4)+1;
      const maxVal = Math.pow(10,length)-1;
      return Math.floor(Math.random()*(maxVal+1));
    }
    if(mode==="Single Action"){
      return Math.floor(Math.random()*10); // 0..9
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
    // Default => 3 dígitos
    return Math.floor(Math.random()*1000);
  }

  function padNumberForMode(num, mode){
    if(mode==="NY Horses"){
      return num.toString();
    }
    if(mode==="Single Action"){
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
    if(!firstNum || !lastNum){
      alert("Please enter both first and last number for Round Down.");
      return;
    }
    if(firstNum.length!==lastNum.length){
      alert("First/Last must have the same length (2,3, or 4 digits).");
      return;
    }

    let start = parseInt(firstNum,10);
    let end   = parseInt(lastNum,10);
    if(isNaN(start) || isNaN(end)){
      alert("Invalid numeric range for Round Down.");
      return;
    }
    if(start> end){
      [start,end] = [end,start];
    }

    const stVal= lockedFields.straight? $("#wizardStraight").val().trim(): $("#wizardStraight").val().trim();
    const bxVal= lockedFields.box? $("#wizardBox").val().trim(): $("#wizardBox").val().trim();
    const coVal= lockedFields.combo? $("#wizardCombo").val().trim(): $("#wizardCombo").val().trim();

    for(let i=start; i<=end; i++){
      let bn = i.toString().padStart(firstNum.length,"0");
      let gm= determineGameMode(bn);
      if(gm==="-") continue;
      let rowT= calculateRowTotal(bn, gm, stVal, bxVal, coVal);
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
    shuffleArray(allDigits);
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
  function shuffleArray(arr){
    for(let i=arr.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]]=[arr[j],arr[i]];
    }
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

  // =========================================================
  // INTRO.JS TUTORIAL (3 idiomas)
  // =========================================================

  // Versión extendida en los tres idiomas:
  const tutorialStepsEN = [
    {
      title: '1. Calendar (Bet Dates)',
      intro: `
        <p><strong>Location:</strong> Top of the form.</p>
        <p>Select one or multiple dates. “Today” is assigned by default. 
        The total multiplies by how many dates are marked.</p>
      `
    },
    {
      title: '2. Tracks (USA, Santo Domingo)',
      intro: `
        <p>Select from the accordion “USA” or “Santo Domingo.” 
        By default, a New York track is chosen if none are selected. 
        Tracks disable automatically after cutoff time.</p>
        <p><strong>Special rules:</strong> 
        - “Venezuela” must be combined with a USA track for 2-digit or Pale-Ven. 
        - RD tracks alone for 2-digit or Pale-RD (no USA selected).</p>
      `
    },
    {
      title: '3. Main Form (Plays Table)',
      intro: `
        <p><strong>Bet Number:</strong> 2, 3, or 4 digits, or Pale (22-50). 
        “Brooklyn” and “Front” require 3 digits. 
        <strong>Straight, Box, Combo</strong> are your wagers. 
        The total for each row is shown. 
        The global total multiplies by number of tracks and dates selected.</p>
        <p>Buttons below: 
        <em>Add Play</em> (new row), 
        <em>Wizard</em> (quick entry window), 
        <em>Remove Last Play</em> (removes final row), 
        <em>Reset Form</em> (clears all).
        Then <em>Generate Ticket</em> shows a <strong>pre-ticket window</strong> with your plays, total, etc. 
        You can edit or confirm and get a unique ticket with QR.</p>
      `
    },
    {
      title: '4. Quick Entry Window (Wizard)',
      intro: `
        <p>Open with the “Wizard” button. 
        You can add multiple plays quickly.</p>
        <ul>
          <li><strong>Bet Number + Add & Next:</strong> Insert 2–4 digits or Pale, or 1 digit if Single Action, then add it to an internal table.</li>
          <li><strong>Lock Straight/Box/Combo:</strong> Reuse the same amounts in subsequent plays.</li>
          <li><strong>Quick Pick:</strong> Generate random numbers for “Pick 3,” “Win 4,” “Single Action,” “NY Horses,” etc.</li>
          <li><strong>Round Down:</strong> Provide a numeric range (e.g. 120..129), it generates all consecutive plays.</li>
          <li><strong>Permute:</strong> Shuffle digits of existing wizard plays.</li>
          <li><strong>Add Main:</strong> Send all wizard plays to the main table. 
              <strong>Generate</strong> => does that plus “Generate Ticket.”</li>
          <li>Each wizard row has a red button with its row number to remove that play individually.</li>
        </ul>
      `
    },
    {
      title: '5. Single Action & NY Horses',
      intro: `
        <p><strong>Single Action:</strong> 1 digit if you selected a standard USA track (not “Venezuela,” not “NY Horses”).</p>
        <p><strong>NY Horses:</strong> 1–4 digits if “New York Horses” track is selected.</p>
      `
    },
    {
      title: '6. Generating the Ticket',
      intro: `
        <p>When you press “Generate Ticket,” a <em>preview window</em> appears with your plays, dates, tracks, total, etc. 
        If changes are needed, press “Edit.” 
        Otherwise, “Confirm & Print” gives you a unique ticket number, QR, and downloads a ticket image. 
        You can share it via the “Share Ticket” button or from your downloads folder.</p>
      `
    }
  ];

  const tutorialStepsES = [
    {
      title: '1. Calendario (Selección de Fechas)',
      intro: `
        <p><strong>Ubicación:</strong> Parte superior del formulario principal.</p>
        <p><strong>Uso:</strong><br>
        - Seleccione una o varias fechas, hoy se asigna por defecto.<br>
        - Cada fecha marcada multiplica el total.<br>
        - Para desmarcar, haga clic de nuevo en la fecha.</p>
      `
    },
    {
      title: '2. Selección de Tracks (USA y RD)',
      intro: `
        <p>Expanda los acordeones para ver las loterías. 
        El sistema elige un track de NY si no hay ninguno marcado. 
        Al marcar un track (excepto “Venezuela”), aumenta el multiplicador del total. 
        “Venezuela” se combina con un track de USA.<br>
        Los tracks de RD se marcan solos para “RD-Quiniela” o “Pale-RD.” 
        Si marca “hoy,” los tracks se desactivan automáticamente al cierre.</p>
      `
    },
    {
      title: '3. Formulario Principal (Tabla de Jugadas)',
      intro: `
        <p>Cada fila incluye <em>Bet Number</em> (2, 3 o 4 dígitos o Pale). 
        Para “Brooklyn” o “Front,” se usan 3 dígitos (tomados del Win4). 
        Introduzca montos en <em>Straight</em>, <em>Box</em>, <em>Combo</em>. 
        El total global se multiplica por la cantidad de tracks (excepto Venezuela) y fechas.<br>
        Botones: 
        <strong>Add Play</strong> (nueva fila), 
        <strong>Wizard</strong> (ventana rápida), 
        <strong>Remove Last</strong> (quita la última fila),
        <strong>Reset Form</strong> (limpia todo).
        Luego “Generate Ticket” muestra una <u>ventana de pre-ticket</u> con QR, 
        donde se puede <em>Editar</em> o <em>Confirmar</em>.</p>
      `
    },
    {
      title: '4. Ventana “Wizard” (Entrada Rápida)',
      intro: `
        <p><strong>Ingreso masivo:</strong><br>
        - <em>Bet Number + Add & Next</em>: 2–4 dígitos (o 1 si Single Action), se añade a la tabla interna.<br>
        - <em>Candados Straight/Box/Combo</em>: repiten el mismo valor sin reescribir.<br>
        - <em>Quick Pick</em>: genera números aleatorios (Pick3, Win4, Single Action, NY Horses, etc.).<br>
        - <em>Round Down</em>: rango consecutivo (ej. 120..129).<br>
        - <em>Permute</em>: baraja dígitos de lo ya generado.<br>
        - Cada jugada tiene un botón rojo con el <u>número</u> de esa jugada para eliminarla individualmente.<br>
        - <em>Add Main</em> => pasa todo al formulario principal. 
        <em>Generate</em> => lo mismo y abre “Generate Ticket.”</p>
      `
    },
    {
      title: '5. Modalidades “Single Action” y “NY Horses”',
      intro: `
        <p><strong>Single Action:</strong> si marca un track de USA (no Venezuela, no Horses) y el Bet Number tiene 1 dígito.</p>
        <p><strong>NY Horses:</strong> si marca “New York Horses,” 1–4 dígitos => “NY Horses.”</p>
      `
    },
    {
      title: '6. Generar Ticket y Vista Previa',
      intro: `
        <p>Al pulsar “Generate Ticket,” verá la <em>ventana de pre-ticket</em> con jugadas, total, fechas y tracks. 
        Puede <em>Editar</em> (regresar al formulario), o <em>Confirmar & Print</em>, que asigna un número de ticket único y genera el QR. 
        Se descarga la imagen del ticket y puede compartirlo con “Share Ticket” o desde descargas.</p>
      `
    }
  ];

  const tutorialStepsHT = [
    {
      title: '1. Dat Pari',
      intro: `
        <p>Chwazi youn oswa plizyè dat pou pari ou. Jodi a se default. 
        Plizyè dat ap miltipliye total ou.</p>
      `
    },
    {
      title: '2. Tracks (USA / RD)',
      intro: `
        <p>Make kous (USA oswa Santo Domingo). 
        “Venezuela” mande kombine ak USA. 
        RD mande track dominiken san track USA.</p>
      `
    },
    {
      title: '3. Tab Pari (Main Form)',
      intro: `
        <p>Bet Number (2,3,4 chif oswa Pale). 
        “Brooklyn/Front” se 3 chif (soti nan Win4). 
        Mete Straight, Box, Combo. 
        Total la miltipliye ak konbyen track (san Venezuela) ak dat ou pran.</p>
        <p>Bouton: <strong>Add Play</strong> (nouvo liy), 
        <strong>Wizard</strong> (fenèt antre rapid), 
        <strong>Remove Last</strong>, 
        <strong>Reset Form</strong>. 
        Apre sa, <strong>Generate Ticket</strong> => fenèt preview tikè (QR), 
        ou ka Edit oswa Confirm.</p>
      `
    },
    {
      title: '4. Fenèt “Wizard” (Antre Rapid)',
      intro: `
        <p>Fè plizyè parye vit:</p>
        <ul>
          <li><em>Bet Number + Add & Next:</em> 2–4 chif oswa 1 chif (Single Action), li ale nan tablo entè.</li>
          <li><em>Candado Straight/Box/Combo:</em> Kenbe menm valè san reekri.</li>
          <li><em>Quick Pick:</em> Genera nimewo o aza (Pick3, Win4, Single Action, NY Horses...).</li>
          <li><em>Round Down:</em> Sekans 120..129.</li>
          <li><em>Permute:</em> Melanje chif yo.</li>
          <li>Chak parye gen bouton wouj ak <u>nimewo</u> li pou retire li separeman.</li>
          <li><em>Add Main</em> => mete tout nan tablo prensipal, 
              <em>Generate</em> => kreye tikè dirèk.</li>
        </ul>
      `
    },
    {
      title: '5. Single Action / NY Horses',
      intro: `
        <p><strong>Single Action:</strong> 1 chif si se track USA (pa Venezuela, pa Horses).</p>
        <p><strong>NY Horses:</strong> 1–4 chif si track “New York Horses.”</p>
      `
    },
    {
      title: '6. Generar Ticket (Preview)',
      intro: `
        <p>Lè w peze “Generate Ticket,” ou wè fenèt preview tikè a ak parye ou, total, dat, track. 
        Ou ka <em>Edit</em> pou tounen, oswa <em>Confirm & Print</em> pou jwenn yon nimewo tikè inik ak QR. 
        Tikè a telechaje kòm imaj, ou ka pataje li ak “Share Ticket” oswa soti nan download ou.</p>
      `
    }
  ];

  function startTutorial(lang) {
    let steps;
    let nextLabel = 'Next';
    let prevLabel = 'Back';
    let skipLabel = 'Skip';
    let doneLabel = 'Done';

    if(lang === 'en'){
      steps = tutorialStepsEN;
    } else if(lang === 'es'){
      steps = tutorialStepsES;
      nextLabel = 'Siguiente';
      prevLabel = 'Atrás';
      skipLabel = 'Saltar';
      doneLabel = 'Listo';
    } else {
      steps = tutorialStepsHT;
      // Podrías cambiar los labels a criollo si quisieras
    }

    introJs().setOptions({
      steps,
      showStepNumbers: true,
      showProgress: true,
      exitOnOverlayClick: true,
      scrollToElement: false,
      nextLabel,
      prevLabel,
      skipLabel,
      doneLabel
    }).start();
  }

  $("#helpEnglish").click(()=>startTutorial('en'));
  $("#helpSpanish").click(()=>startTutorial('es'));
  $("#helpCreole").click(()=>startTutorial('ht'));

  // =========================================================
  // MANUAL DETALLADO (3 idiomas)
  // =========================================================
  // A continuación, los 3 manuales “completos” con la misma estructura.
  // 1) EN, 2) ES, 3) Kreyòl

  const manualEnglishHTML = `
    <h4>Complete Lottery App Manual (English)</h4>
    <ol>
      <li><strong>Calendar (Bet Dates):</strong><br>
        <p>Located at the top of the form. You can pick multiple dates. “Today” is chosen by default. 
           The total multiplies by the number of dates selected.</p>
      </li>
      <li><strong>Tracks (USA / Santo Domingo):</strong><br>
        <p>Below the calendar, we have two accordions: “USA” and “Santo Domingo.” 
           By default, if no track is selected, the system picks a New York track. 
           Checking a track (except “Venezuela”) increases the total multiplier. 
           “Venezuela” must be combined with at least one USA track to play “Venezuela” or “Pale-Ven.” 
           RD tracks require no USA for “RD-Quiniela” or “Pale-RD.”</p>
      </li>
      <li><strong>Main Form (Plays Table):</strong><br>
        <p>Each row has a <em>Bet Number</em> (2–4 digits, or a Palé like 22-50). 
           For “Brooklyn” or “Front,” you must use 3 digits. 
           Enter <em>Straight</em>, <em>Box</em>, <em>Combo</em> amounts. 
           The row total is shown on the right. The overall total also multiplies by the number of tracks and dates. 
           Buttons: <em>Add Play</em> (adds row), <em>Wizard</em> (opens Quick Entry Window), 
           <em>Remove Last Play</em>, <em>Reset Form</em>. 
           Then “Generate Ticket” opens a <u>Pre-Ticket Window</u> to preview and confirm your ticket.</p>
      </li>
      <li><strong>Wizard Window (Quick Entry):</strong><br>
        <p>Click “Wizard” to open a window that helps you create multiple plays quickly. 
           You can:  
           - Enter Bet Number + “Add & Next” repeatedly,  
           - Lock Straight, Box, Combo,  
           - Do Quick Pick for random numbers,  
           - Round Down for consecutive ranges,  
           - Permute digits.  
           Each row has a red button with that row number to remove it individually.  
           Finally, “Add Main” sends these plays to the main table, or “Generate” does that plus creates the ticket instantly.</p>
      </li>
      <li><strong>Single Action & NY Horses:</strong><br>
        <p>
          <em>Single Action</em>: If you select a USA track (not “Venezuela,” not “NY Horses”) and you enter exactly 1 digit, 
          the system calls it “Single Action.”  
          <em>NY Horses</em>: If you mark “New York Horses,” any Bet Number of 1–4 digits is “NY Horses.”</p>
      </li>
      <li><strong>Generate Ticket & Preview:</strong><br>
        <p>Press “Generate Ticket” to see the pre-ticket window with all plays, total, date(s), and tracks. 
           You can <em>Edit</em> to return, or <em>Confirm & Print</em> to finalize. 
           That assigns a unique Ticket Number, creates a QR code, downloads the image, 
           and you can share with “Share Ticket” or from your downloads folder. 
           If you close without confirming, you may return and edit as needed.</p>
      </li>
    </ol>
  `;

  const manualSpanishHTML = `
    <h4>Manual Completo de la App de Loterías (Español)</h4>
    <ol>
      <li><strong>Calendario (Selección de Fechas):</strong>
        <p>Ubicado arriba. Puede marcar varias fechas, “hoy” se asigna por defecto. 
           El total se multiplica por cuántas fechas seleccione. 
           Para desmarcar, haga clic de nuevo en la fecha.</p>
      </li>
      <li><strong>Selección de Tracks (USA / Santo Domingo):</strong>
        <p>Bajo el calendario, hay 2 acordeones: “USA” y “Santo Domingo.” 
           Si no hay ninguno marcado, el sistema elige un track de NY por defecto. 
           Al marcar un track (excepto “Venezuela”), el total se multiplica. 
           “Venezuela” debe combinarse con un track de USA. 
           RD se marca sin USA para “RD-Quiniela” o “Pale-RD.” 
           Si hoy es la fecha, los tracks se desactivan al llegar su hora límite.</p>
      </li>
      <li><strong>Formulario Principal (Tabla de Jugadas):</strong>
        <p>Cada fila tiene un <em>Bet Number</em> (2–4 dígitos o un Pale). 
           Para “Brooklyn” o “Front,” se requieren 3 dígitos. 
           Ingrese <em>Straight</em>, <em>Box</em>, <em>Combo</em>. 
           El total global se multiplica por la cantidad de tracks (sin Venezuela) y fechas. 
           Botones: <em>Add Play</em>, <em>Wizard</em>, <em>Remove Last Play</em>, <em>Reset Form</em>. 
           Al final, <em>Generate Ticket</em> muestra una ventana de pre-ticket con QR, 
           donde puede editar o confirmar.</p>
      </li>
      <li><strong>Ventana “Wizard” (Entrada Rápida):</strong>
        <p>Se abre con el botón “Wizard.” 
           Permite ingresar múltiples jugadas rápido. 
           - <em>Bet Number + Add & Next</em> para añadir filas internas, 
           - candados en <em>Straight, Box, Combo</em> para bloquear los montos, 
           - <em>Quick Pick</em> (números aleatorios), 
           - <em>Round Down</em> (rango consecutivo), 
           - <em>Permute</em> (baraja dígitos). 
           Cada jugada tiene un botón rojo con su número para quitarla individualmente. 
           Luego <em>Add Main</em> pasa todo a la tabla principal, 
           <em>Generate</em> crea el ticket inmediatamente.</p>
      </li>
      <li><strong>Single Action y NY Horses:</strong>
        <p><em>Single Action</em>: 1 dígito si es un track de USA (excepto “Venezuela” y “NY Horses”).<br>
           <em>NY Horses</em>: 1–4 dígitos si marcó “New York Horses.”</p>
      </li>
      <li><strong>Generar Ticket y Vista Previa:</strong>
        <p>Al pulsar “Generate Ticket,” aparece la ventana de <em>pre-ticket</em> con todo: jugadas, total, fechas, tracks. 
           Puede <em>Edit</em> para volver o <em>Confirm & Print</em> para asignar un número único y QR. 
           Se descarga el ticket como imagen y lo puede compartir con “Share Ticket” o desde sus descargas. 
           Si cierra sin confirmar, puede seguir editando en la tabla principal.</p>
      </li>
    </ol>
  `;

  const manualCreoleHTML = `
    <h4>Manyèl Konplè pou Aplikasyon Lòtri (Kreyòl)</h4>
    <ol>
      <li><strong>Dat Pari (Kalendriye):</strong>
        <p>Sitiye anwo fòm lan. Ou ka chwazi youn oswa plizyè jou. “Jodi a” se default. 
           Total la miltipliye ak konbyen jou ou make. 
           Pou demake, klike ankò sou dat la.</p>
      </li>
      <li><strong>Tracks (USA / Santo Domingo):</strong>
        <p>Anba kalendriye a gen 2 accordion: “USA” ak “Santo Domingo.” 
           Si pa gen anyen make, li chwazi yon New York track otomatikman. 
           Check track (san Venezuela) ap ogmante total la. 
           “Venezuela” dwe ak yon track USA pou 2 chif oswa Pale-Ven. 
           RD separe pou “RD-Quiniela” oswa “Pale-RD.” 
           Si se jodi a, track yo ap fèmen otomatikman when cutoff tan rive.</p>
      </li>
      <li><strong>Tablo Pari (Main Form):</strong>
        <p>Chak liy gen <em>Bet Number</em> (2–4 chif oswa Pale). 
           “Brooklyn” oswa “Front” se 3 chif. 
           Mete <em>Straight</em>, <em>Box</em>, <em>Combo</em>. 
           Total jeneral miltipliye pa konbyen track (san Venezuela) ak dat. 
           Bouton: <em>Add Play</em> (nouvo liy), <em>Wizard</em> (fenèt rapid), 
           <em>Remove Last Play</em>, <em>Reset Form</em>. 
           “Generate Ticket” ap montre fenèt pre-ticket ak QR, 
           ou ka Edit oswa Confirm.</p>
      </li>
      <li><strong>Fenèt “Wizard” (Antre Rapid):</strong>
        <p>Ouvri ak bouton “Wizard.” 
           Ou ka antre plizyè parye vit:  
           - <em>Bet Number + Add & Next</em>,  
           - Candado pou <em>Straight/Box/Combo</em>,  
           - <em>Quick Pick</em> (Pick3, Win4, Single Action, NY Horses...),  
           - <em>Round Down</em> (sekans 120..129),  
           - <em>Permute</em> (melanje chif),  
           - Bouton wouj ak nimewo pou retire liy separeman,  
           - <em>Add Main</em> => mete parye yo nan tablo prensipal,  
           - <em>Generate</em> => kreye tikè imedyatman.</p>
      </li>
      <li><strong>Single Action ak NY Horses:</strong>
        <p><em>Single Action:</em> 1 chif si se track USA (pa “Venezuela,” pa “NY Horses”).<br>
           <em>NY Horses:</em> 1–4 chif si ou check “New York Horses.”</p>
      </li>
      <li><strong>Jenere Tikè ak Previa:</strong>
        <p>Lè w peze “Generate Ticket,” fenèt <em>pre-ticket</em> parèt ak tout parye, total, dat, track. 
           Ou ka <em>Edit</em> pou tounen, oswa <em>Confirm & Print</em> pou jwenn yon nimewo inik ak QR. 
           L ap telechaje imaj tikè a, ou ka pataje avè “Share Ticket” oswa soti nan download ou. 
           Si w pa konfime, ou ka retounen modifye tablo a.</p>
      </li>
    </ol>
  `;

  // Insertar en los div correspondientes
  $("#manualEnglishText").html(manualEnglishHTML);
  $("#manualSpanishText").html(manualSpanishHTML);
  $("#manualCreoleText").html(manualCreoleHTML);

  // Ocultar ES y HT al inicio, dejar EN visible o como prefieras
  $("#manualSpanishText").addClass("d-none");
  $("#manualCreoleText").addClass("d-none");

  // Botones para el manual
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

});
