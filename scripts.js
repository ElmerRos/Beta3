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
      // Forzamos la fecha de hoy en el campo
      // solo si no se ha seleccionado nada
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
  // DETERMINE GAME MODE
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

    // 1) "NY Horses" => si se marca "New York Horses", sin importar cuántos dígitos
    if(includesHorses){
      return "NY Horses";
    }

    // 2) Single Action => 1 dígito, track de USA (excepto Venezuela y Horses)
    //    Si esUSA && no includesVenezuela && no includesHorses && betNumber.length===1
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

    // 4) Checar longitud
    const length = betNumber.length;
    if(length<2 || length>4) return "-";

    // 5) Lógica general
    // Pulito (2 dígitos) => si hay tracks USA y no SD
    if(isUSA && !isSD && length===2){
      return "Pulito";
    }
    // Venezuela => 2 dígitos + (Venezuela + track USA)
    if(length===2 && includesVenezuela && isUSA){
      return "Venezuela";
    }
    // RD-Quiniela => 2 dígitos + track SD (sin USA)
    if(length===2 && isSD && !isUSA){
      return "RD-Quiniela";
    }
    // 3 dígitos => Pick 3
    if(length===3){
      return "Pick 3";
    }
    // 4 dígitos => Win 4
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
      let totalSA = st + numericBox + combo;
      return totalSA.toFixed(2);
    }

    // NY Horses => sin limit, sum st+box+combo
    if(gm==="NY Horses"){
      const numericBox = parseFloat(bxVal)||0;
      let totalNY = st + numericBox + combo;
      return totalNY.toFixed(2);
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
      const st = $(this).find(".straight").val();
      const bx = $(this).find(".box").val();
      const co = $(this).find(".combo").val();

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
      if(["Venezuela","Pale-Ven","Pulito","RD-Quiniela","Pale-RD"].includes(gm)){
        if(!st || parseFloat(st)<=0){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight").addClass("error-field");
        }
        if(gm==="Pulito" && !bx){
          // Pulito => box must have positions
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".box").addClass("error-field");
        }
      }
      else if(["Win 4","Pick 3"].includes(gm)){
        const sVal=parseFloat(st)||0;
        const bVal=parseFloat(bx)||0;
        const cVal=parseFloat(co)||0;
        if(sVal<=0 && bVal<=0 && cVal<=0){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight,.box,.combo").addClass("error-field");
        }
      }
      // Single Action => si st+box+combo=0 => error
      if(gm==="Single Action"){
        const sVal=parseFloat(st)||0;
        const bVal=parseFloat(bx)||0;
        const cVal=parseFloat(co)||0;
        if(sVal<=0 && bVal<=0 && cVal<=0){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight,.box,.combo").addClass("error-field");
        }
      }
      // NY Horses => idem, si st+box+combo=0 => error
      if(gm==="NY Horses"){
        const sVal=parseFloat(st)||0;
        const bVal=parseFloat(bx)||0;
        const cVal=parseFloat(co)||0;
        if(sVal<=0 && bVal<=0 && cVal<=0){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight,.box,.combo").addClass("error-field");
        }
      }

      if(errorHere) valid=false;
    });

    if(!valid){
      const uniqueErr=[...new Set(errors)].join(", ");
      alert(`Some plays have errors (row(s): ${uniqueErr}). Please fix them.`);
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
    // "NY Horses" => genera de 1..4 dígitos (similar a Single Action)
    if(mode==="NY Horses"){
      const length = Math.floor(Math.random()*4)+1;
      const maxVal = Math.pow(10,length)-1;
      return Math.floor(Math.random()*(maxVal+1));
    }
    if(mode==="Single Action"){
      // 1 dígito
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
    // Default => generamos un 3 dígitos
    return Math.floor(Math.random()*1000);
  }

  function padNumberForMode(num, mode){
    // NY Horses => sin padding forzado
    if(mode==="NY Horses"){
      return num.toString();
    }
    // Single Action => 1 dígito => devolvemos tal cual
    if(mode==="Single Action"){
      return num.toString();
    }
    // Pale-Ven / Pale-RD / Win 4 => 4 dígitos
    if(mode==="Pale-Ven"||mode==="Pale-RD"||mode==="Win 4"){
      let s=num.toString();
      while(s.length<4) s="0"+s;
      return s;
    }
    // Pulito, RD-Quiniela, Venezuela => 2 dígitos
    if(mode==="Pulito"||mode==="RD-Quiniela"||mode==="Venezuela"){
      let s=num.toString();
      while(s.length<2) s="0"+s;
      return s;
    }
    // Pick 3 => 3 dígitos
    if(mode==="Pick 3"){
      let s=num.toString();
      while(s.length<3) s="0"+s;
      return s;
    }
    // Default => 3 dígitos
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
  const tutorialStepsEN = [
    {
      element: '#fecha',
      title: 'Bet Dates',
      intro: 'Pick one or more dates for your bets. Today is preselected.'
    },
    {
      element: '.accordion',
      title: 'Tracks',
      intro: 'Choose the tracks you want (USA, Santo Domingo...). Some tracks disable automatically after cutoff time.'
    },
    {
      element: '#jugadasTable',
      title: 'Plays Table',
      intro: 'Add your plays (Bet Number, Straight, Box, Combo). The “Game Mode” is detected automatically.'
    },
    {
      element: '#agregarJugada',
      title: 'Add Play',
      intro: 'Press here to add a new empty row in the table.'
    },
    {
      element: '#wizardButton',
      title: 'Wizard Button',
      intro: 'Click this Wizard button to open the Quick Entry Window. Then press Next.'
    },
    {
      title: 'Inside the Wizard',
      intro: 'Now that you opened the Window, you can add plays quickly.'
    },
    {
      element: '#wizardBetNumber',
      title: 'Bet Number',
      intro: 'Enter 1–4 digits, or 2–4 for other modes, or a Pale like 22-50. Then “Add & Next.”'
    },
    {
      element: '#lockStraight',
      title: 'Lock Straight',
      intro: 'Locks the Straight amount so it repeats in each new bet.'
    },
    {
      element: '#lockBox',
      title: 'Lock Box',
      intro: 'Similarly for Box.'
    },
    {
      element: '#lockCombo',
      title: 'Lock Combo',
      intro: 'And for Combo.'
    },
    {
      element: '#btnGenerateQuickPick',
      title: 'Quick Pick',
      intro: 'Generates random numbers. You can choose “Single Action,” “NY Horses,” “Pick 3,” etc.'
    },
    {
      element: '#btnGenerateRoundDown',
      title: 'Round Down',
      intro: 'Generates consecutive sequences from a first to a last number.'
    },
    {
      element: '#wizardAddAllToMain',
      title: 'Add Main',
      intro: 'Sends all Wizard plays to the main table.'
    },
    {
      element: '#wizardGenerateTicket',
      title: 'Generate from Wizard',
      intro: 'Generates the Ticket directly from here.'
    },
    {
      element: '#wizardEditMainForm',
      title: 'Edit Main',
      intro: 'Or you can close the Wizard and edit the main table again.'
    },
    {
      title: 'Generate Ticket (Preview)',
      intro: 'Finally, when ready, press Generate Ticket in the main form to see the preview.'
    }
  ];

  const tutorialStepsES = [
    {
      element: '#fecha',
      title: 'Fechas',
      intro: 'Selecciona una o varias fechas de apuesta; hoy se asigna por defecto.'
    },
    {
      element: '.accordion',
      title: 'Tracks',
      intro: 'Elige tus tracks (USA o Santo Domingo). Algunos se desactivan automáticamente al llegar la hora de cierre.'
    },
    {
      element: '#jugadasTable',
      title: 'Tabla de Jugadas',
      intro: 'Ingresa tus jugadas (Bet Number, Straight, Box, Combo). El modo de juego se detecta solo.'
    },
    {
      element: '#agregarJugada',
      title: 'Add Play',
      intro: 'Presiona para agregar una nueva fila vacía en la tabla.'
    },
    {
      element: '#wizardButton',
      title: 'Botón Wizard',
      intro: 'Haz clic para abrir la ventana de entrada rápida. Luego presiona “Siguiente.”'
    },
    {
      title: 'Dentro del Wizard',
      intro: 'Ahora que abriste la ventana, puedes añadir jugadas rápidamente.'
    },
    {
      element: '#wizardBetNumber',
      title: 'Bet Number',
      intro: 'Ingresa 1–4 dígitos (ej. Single Action o NY Horses) o 2–4 dígitos, o Pale (22-50). Luego “Add & Next.”'
    },
    {
      element: '#lockStraight',
      title: 'Candado Straight',
      intro: 'Bloquea la cantidad en Straight para repetirla cada vez.'
    },
    {
      element: '#lockBox',
      title: 'Candado Box',
      intro: 'Lo mismo para Box.'
    },
    {
      element: '#lockCombo',
      title: 'Candado Combo',
      intro: 'Y para Combo también.'
    },
    {
      element: '#btnGenerateQuickPick',
      title: 'Quick Pick',
      intro: 'Genera números aleatorios (Single Action, NY Horses, Pick 3, Win 4, etc.).'
    },
    {
      element: '#btnGenerateRoundDown',
      title: 'Round Down',
      intro: 'Genera secuencias consecutivas de un número inicial a uno final.'
    },
    {
      element: '#wizardAddAllToMain',
      title: 'Add Main',
      intro: 'Pasa todas las jugadas del Wizard a la tabla principal.'
    },
    {
      element: '#wizardGenerateTicket',
      title: 'Generar (Wizard)',
      intro: 'También puedes generar el Ticket directamente desde aquí.'
    },
    {
      element: '#wizardEditMainForm',
      title: 'Editar Principal',
      intro: 'O cerrar el Wizard y seguir editando la tabla principal.'
    },
    {
      title: 'Generar Ticket (Vista Previa)',
      intro: 'Cuando termines, presiona “Generate Ticket” en el formulario principal para ver la vista previa.'
    }
  ];

  const tutorialStepsHT = [
    {
      element: '#fecha',
      title: 'Dat Pari',
      intro: 'Chwazi youn oswa plizyè dat; jodi a mete otomatikman.'
    },
    {
      element: '.accordion',
      title: 'Tracks',
      intro: 'Chwazi kous ou vle (USA oswa Santo Domingo). Gen kous ki fèmen otomatikman.'
    },
    {
      element: '#jugadasTable',
      title: 'Tab Pari',
      intro: 'Antre pari ou: Bet Number, Straight, Box, Combo. Mòd jwe a detekte otomatik.'
    },
    {
      element: '#agregarJugada',
      title: 'Add Play',
      intro: 'Peze la pou ajoute yon nouvo liy vid.'
    },
    {
      element: '#wizardButton',
      title: 'Bouton Wizard',
      intro: 'Klike pou louvri fenèt antre rapid. Apre sa, “Siguiente.”'
    },
    {
      title: 'Andedan Wizard la',
      intro: 'Kounye a ou louvri fenèt la, ou ka ajoute parye rapid.'
    },
    {
      element: '#wizardBetNumber',
      title: 'Bet Number',
      intro: 'Antre 1–4 chif (Single Action, NY Horses) oswa 2–4, oswa Pale (22-50). Apre sa, “Add & Next.”'
    },
    {
      element: '#lockStraight',
      title: 'Lock Straight',
      intro: 'Kenbe valè Straight la pou li retounen chak fwa.'
    },
    {
      element: '#lockBox',
      title: 'Lock Box',
      intro: 'Menm bagay pou Box.'
    },
    {
      element: '#lockCombo',
      title: 'Lock Combo',
      intro: 'Ak Combo tou.'
    },
    {
      element: '#btnGenerateQuickPick',
      title: 'Quick Pick',
      intro: 'Genera nimewo o aza (Single Action, NY Horses, Pick3, Win4, elatriye).'
    },
    {
      element: '#btnGenerateRoundDown',
      title: 'Round Down',
      intro: 'Kreye sekans soti nan yon nimewo inisyal rive nan yon final.'
    },
    {
      element: '#wizardAddAllToMain',
      title: 'Add Main',
      intro: 'Mete tout parye Wizard yo nan tablo prensipal.'
    },
    {
      element: '#wizardGenerateTicket',
      title: 'Generate (Wizard)',
      intro: 'Ou ka jenere tikè dirèkteman.'
    },
    {
      element: '#wizardEditMainForm',
      title: 'Edit Main',
      intro: 'Oubyen fèmen Wizard la pou retounen sou tablo prensipal la.'
    },
    {
      title: 'Generar Ticket (Vista Previa)',
      intro: 'Finalman, peze “Generate Ticket” pou wè Vista Previa tikè a.'
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
  // MANUAL: Insertamos el texto completo en 3 idiomas
  // =========================================================

  const manualEnglishHTML = `
    <h4>Lottery App Manual (English)</h4>
    <p><strong>Date Selection:</strong> The date input lets you pick one or multiple betting dates. Today is automatically assigned.</p>
    <p><strong>Tracks:</strong> Expand the “USA” or “Santo Domingo” sections. Mark the tracks you want. Some tracks will disable after cutoff time. If you pick “Venezuela,” combine it with a USA track to do Venezuelan plays. For “NY Horses,” you can enter any digits (1–4) and it will appear as “NY Horses.”</p>
    <p><strong>Plays Table:</strong> Each row has a Bet Number, which determines the game mode (Pulito, Pick 3, Win 4, Single Action, NY Horses, etc.). Straight/Box/Combo amounts can be added. The total for that row is displayed. The overall total is multiplied by your number of selected dates and tracks.</p>
    <p><strong>Single Action:</strong> Occurs if you pick a standard USA track (not Venezuela, not NY Horses) and input exactly 1 digit in Bet Number. Then the mode is “Single Action.”</p>
    <p><strong>NY Horses:</strong> If “New York Horses” is marked, any number of digits (1–4) results in “NY Horses.”</p>
    <p><strong>Buttons:</strong></p>
    <ul>
      <li><strong>Add Play:</strong> Adds a new row in the table.</li>
      <li><strong>Wizard:</strong> Opens the Quick Entry Window for bulk or random plays.</li>
      <li><strong>Remove Last Play:</strong> Removes the final row from the table.</li>
      <li><strong>Reset Form:</strong> Clears everything (dates, tracks, table).</li>
      <li><strong>Generate Ticket:</strong> Shows the Ticket Preview window, where you can confirm, print, or share the ticket.</li>
    </ul>
    <p><strong>Quick Entry Window (Wizard):</strong> You can add multiple plays quickly, lock amounts (Straight, Box, Combo), generate Quick Picks, do Round Down sequences, or permute digits. Then click “Add Main” to pass them to the main table or “Generate” to create a ticket directly.</p>
    <p><strong>Ticket Preview:</strong> Upon generating a ticket, you see a preview with all plays, total amount, and a QR code. You can edit (return to the form) or confirm and print/share. A unique Ticket Number is assigned once you confirm.</p>
  `;

  const manualSpanishHTML = `
    <h4>Manual de la App de Loterías (Español)</h4>
    <p><strong>Selección de Fechas:</strong> El campo de fecha permite elegir una o varias fechas de apuesta. Hoy se asigna automáticamente.</p>
    <p><strong>Tracks:</strong> Expande las secciones “USA” o “Santo Domingo”. Marca los tracks deseados. Algunos se desactivan al llegar la hora de cierre. Si eliges “Venezuela,” debes combinarlo con algún track de USA para que funcione. El track “New York Horses” te permite ingresar 1–4 dígitos y el modo será “NY Horses.”</p>
    <p><strong>Tabla de Jugadas:</strong> Cada fila tiene un Bet Number, que determina el modo de juego (Pulito, Pick 3, Win 4, Single Action, NY Horses, etc.). Ingresas montos en Straight/Box/Combo. El total de la fila se muestra a la derecha. El total global se multiplica por la cantidad de fechas y tracks.</p>
    <p><strong>Single Action:</strong> Se activa si eliges un track de USA (no Venezuela, no NY Horses) y pones exactamente 1 dígito en Bet Number.</p>
    <p><strong>NY Horses:</strong> Si marcas “New York Horses,” cualquier cantidad de dígitos (1–4) se considerará “NY Horses.”</p>
    <p><strong>Botones:</strong></p>
    <ul>
      <li><strong>Add Play:</strong> Agrega una fila nueva en la tabla.</li>
      <li><strong>Wizard:</strong> Abre la ventana de entrada rápida (Quick Entry) para añadir muchas jugadas.</li>
      <li><strong>Remove Last Play:</strong> Quita la última fila.</li>
      <li><strong>Reset Form:</strong> Limpia todo (fechas, tracks, jugadas).</li>
      <li><strong>Generate Ticket:</strong> Muestra la ventana de Vista Previa del ticket, donde puedes confirmar, imprimir o compartir.</li>
    </ul>
    <p><strong>Ventana Quick Entry (Wizard):</strong> Allí puedes introducir jugadas en bloque, bloquear montos (Straight, Box, Combo), generar Quick Picks, Round Down, o permutar dígitos. Luego “Add Main” pasa todo a la tabla principal, o “Generate” crea el ticket directamente.</p>
    <p><strong>Vista Previa de Ticket:</strong> Al generar el ticket, ves un resumen con tus jugadas, el total y un QR. Puedes editar (regresar al formulario) o confirmar. Una vez confirmas, se asigna un Número de Ticket único y puedes imprimir/compartir.</p>
  `;

  const manualCreoleHTML = `
    <h4>Manyèl Aplikasyon Lòtri (Kreyòl)</h4>
    <p><strong>Chwazi Dat:</strong> Zòn dat la pèmèt ou pran youn oswa plizyè jou parye. Jodi a mete otomatikman.</p>
    <p><strong>Tracks:</strong> Gade seksyon “USA” oswa “Santo Domingo.” Make kous ou vle. Gen kous ki ap dezaktive lè tan fini. Si ou chwazi “Venezuela,” ou dwe itilize tou yon track USA. “New York Horses” pèmèt ou antre 1–4 chif epi mòd la se “NY Horses.”</p>
    <p><strong>Tab Pari:</strong> Chak ranje gen Bet Number, ki detèmine mòd jwe (Pulito, Pick 3, Win 4, Single Action, NY Horses, elatriye). Ou ka mete lajan Straight, Box, Combo. Sòm total la miltipliye selon konbyen dat ak konbyen track ou chwazi.</p>
    <p><strong>Single Action:</strong> Se pou track USA (pa Venezuela, pa NY Horses) ak 1 chif Bet Number.</p>
    <p><strong>NY Horses:</strong> Si “New York Horses” make, 1–4 chif vin “NY Horses.”</p>
    <p><strong>Bouton:</strong></p>
    <ul>
      <li><strong>Add Play:</strong> Ajoute yon nouvo liy vid nan tablo a.</li>
      <li><strong>Wizard:</strong> Louvri fenèt antre rapid pou mete plizyè parye.</li>
      <li><strong>Remove Last Play:</strong> Retire dènye liy la.</li>
      <li><strong>Reset Form:</strong> Efase tout (dat, kous, tablo).</li>
      <li><strong>Generate Ticket:</strong> Montre fenèt Preview tikè a, kote ou ka konfime, enprime, oswa pataje.</li>
    </ul>
    <p><strong>Fenèt Quick Entry (Wizard):</strong> La ou ka antre parye an blok, bloke (Straight, Box, Combo), Quick Pick, Round Down, oswa permute chif. Apre sa, “Add Main” voye parye yo nan tablo prensipal, oswa “Generate” kreye tikè a dirèkteman.</p>
    <p><strong>Preview Ticket:</strong> Lè w kreye tikè a, ou wè rezime ak sòm total + QR. Ou ka modifye (tounen sou tablo) oswa konfime. Lè fini, li bay yon Nimewo Tikè inik pou enprime/pataje.</p>
  `;

  // Insertar texto en cada div del manual
  $("#manualEnglishText").html(manualEnglishHTML);
  $("#manualSpanishText").html(manualSpanishHTML);
  $("#manualCreoleText").html(manualCreoleHTML);

  // Ocultar texto en ES y HT por defecto
  $("#manualSpanishText").addClass("d-none");
  $("#manualCreoleText").addClass("d-none");

  // =========================================================
  // BOTONES Manual (cambiar texto)
  // =========================================================
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
