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
  // DETERMINE GAME MODE (Reordenado para Venezuela vs Pulito)
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

    // 1) "NY Horses" => si se marca "New York Horses", cualquier dígito => "NY Horses"
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

    // 6) Pulito (2 dígitos) => si hay tracks USA y no SD
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
        // Pulito => box debe tener posiciones => ya verificado en calc => si no hay => error
        // (Se hace arriba, ya que no se definió un limit para box)
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
      // LIMITES DE APUESTA (Straight, Box, Combo)
      // ===========================================================
      // Win 4 => st<=6, combo<=6, box<=40
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
      // Pick 3 => st<=35, combo<=35, box<=100
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
      // Venezuela(2 dig) => st<=100
      if(gm==="Venezuela"){
        if(st>100){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight").addClass("error-field");
        }
      }
      // Pulito => st<=100
      if(gm==="Pulito"){
        if(st>100){
          errorHere=true;
          errors.push(rowIndex);
          $(this).find(".straight").addClass("error-field");
        }
      }
      // Otras no definidas => sin límite extra

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
    // "NY Horses" => genera 1..4 dígitos
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
  // Versión resumida en EN y HT, y manual extenso en ES.
  const tutorialStepsEN = [
    {
      element: '#fecha',
      title: 'Bet Dates',
      intro: 'Pick one or more dates for your bets. Today is auto-assigned.'
    },
    {
      element: '.accordion',
      title: 'Tracks',
      intro: 'Choose the tracks (USA, Santo Domingo...).'
    },
    {
      element: '#jugadasTable',
      title: 'Plays Table',
      intro: 'Enter Bet Number (2–4 digits or Palé). Then Straight, Box, Combo.'
    },
    {
      element: '#wizardButton',
      title: 'Wizard Window',
      intro: 'Click here to open the Quick Entry Window. Then continue.'
    },
    {
      title: 'Wizard Explanation',
      intro: 'Inside Wizard, you can add multiple plays quickly.'
    },
    {
      element: '#wizardGenerateTicket',
      title: 'Generate from Wizard',
      intro: 'Or send them to the main table and generate the ticket.'
    },
    {
      element: '#generarTicket',
      title: 'Generate Ticket',
      intro: 'Finally, you can see the Ticket Preview, confirm, print/share.'
    }
  ];

  // **Aquí el manual largo en español** con todas tus correcciones
  const tutorialStepsES = [
    {
      title: '1. Calendario (Selección de Fechas)',
      intro: `
        <p><strong>Ubicación:</strong> En la parte superior del formulario principal.</p>
        <p><strong>Uso:</strong><br>
        - El campo “Bet Dates” muestra un calendario (Flatpickr) al hacer clic.<br>
        - Puede seleccionar varias fechas: haga clic en cada día deseado y se irán marcando.<br>
        - Para deseleccionar una fecha, basta con volver a hacer clic en la misma fecha en el calendario.<br>
        - Por defecto, se muestra la fecha de “hoy” ya seleccionada cuando inicia la app o se hace “Reset Form”.<br>
        <strong>Impacto en el total:</strong><br>
        - El total del ticket se multiplica por la cantidad de fechas seleccionadas.<br>
        - Ej.: si el total básico es 5.00 y ha seleccionado 2 fechas, el total pasa a 10.00.
        </p>
      `
    },
    {
      title: '2. Selección de Tracks (Acordeones “USA” y “Santo Domingo”)',
      intro: `
        <p><strong>Ubicación:</strong> Debajo del calendario, con dos acordeones: “USA” y “Santo Domingo”.</p>
        <p><strong>Funcionamiento:</strong><br>
        - El sistema elige por defecto un track de New York (Mid Day o Evening) si no hay ninguno marcado, para arrancar.<br>
        - Cada track aparece como un “botón” con checkbox.<br>
        - Cuando marca un track, afecta el total: El total se multiplica también por la cantidad de tracks marcados (excepto “Venezuela”, que no cuenta).<br>
        - <strong>Cierre de Tracks:</strong> Si se selecciona “hoy” en el calendario, los tracks se desactivan automáticamente al llegar su hora límite.<br>
        - En la interfaz, verá esos tracks en gris y no podrá marcarlos.</p>
        <p><strong>Reglas especiales:</strong><br>
        - <em>Venezuela:</em> Para jugar “Venezuela” (2 dígitos) o “Pale-Ven” (22–50), debe marcar “Venezuela” y al menos un track de USA.<br>
        - <em>Tracks de RD:</em> Para “RD-Quiniela” (2 dígitos) o “Pale-RD”, se requiere tener al menos un track dominicano (y no tener tracks USA si se quiere Pale-RD).</p>
        <p><strong>Ejemplo de usar ambos países:</strong><br>
        - La app no admite, en un mismo ticket, marcar simultáneamente RD y USA si se pretende jugadas “Pale-RD” y “Pale-Ven”. Podría confundirse la detección.<br>
        - Alternativa: primero se marcan los tracks de un país, se ingresan jugadas, luego se desmarcan y se marcan los del otro país sin resetear, etc.</p>
      `
    },
    {
      title: '3. Formulario Principal (Tabla de Jugadas)',
      intro: `
        <p>3.1. <strong>Campos de la Tabla</strong><br>
        - <strong>Bet Number:</strong> Aquí se escribe el número de la jugada (2, 3 o 4 dígitos) o un Pale (22-33, etc.).<br>
        - Para “Venezuela” son 2 dígitos; “Pulito” (en tracks USA) también 2 dígitos.<br>
        - “Pick 3” = 3 dígitos.<br>
        - “Win 4” = 4 dígitos.<br>
        - <strong>Brooklyn Mid Day / Evening y Front Midday / Evening:</strong> Se requiere 3 dígitos, pues son los 3 dígitos finales (Brooklyn) o los 3 dígitos iniciales (Front) del Win4 de New York.<br><br>
        - <strong>Straight ($):</strong> Monto a apostar al número exacto.<br>
        - <strong>Box ($):</strong> Monto para la modalidad Box (posiciones distintas).<br>
        - <strong>Combo ($):</strong> Monto para la modalidad combinada (ej. Win4/Pick3).<br>
        - Algunos juegos exigen Straight > 0 (Venezuela, RD-Quiniela).
        </p>
        <p>3.2. <strong>Detección de Modo de Juego</strong><br>
        - <strong>Pulito</strong> (2 dígitos, solo si hay tracks USA, sin SD). Además, requiere que se especifiquen posiciones en Box para multiplicar la apuesta.<br>
        - <strong>Pick 3</strong> (3 dígitos).<br>
        - <strong>Win 4</strong> (4 dígitos).<br>
        - <strong>Venezuela</strong> (2 dígitos, solo si “Venezuela” y uno o varios tracks de USA).<br>
        - <strong>Pale-Ven</strong> (“22-50” o “22x50”). Requiere “Venezuela” + track de USA.<br>
        - <strong>RD-Quiniela</strong> (2 dígitos, con track dominicano, sin USA).<br>
        - <strong>Pale-RD</strong> (22-50, con track SD, sin track USA).<br>
        - <strong>Single Action</strong> (1 dígito en un track de USA, excepto “Venezuela” y “NY Horses”).<br>
        - <strong>NY Horses</strong> (cualquier 1–4 dígitos si el track es “New York Horses”).<br>
        </p>
        <p>3.3. <strong>Botones Principales</strong><br>
        - <strong>Add Play:</strong> Agrega una fila vacía al final.<br>
        - <strong>Wizard:</strong> Abre la ventana “Quick Entry Wizard” (ver más adelante).<br>
        - <strong>Remove Last Play:</strong> Elimina la última fila de la tabla.<br>
        - <strong>Reset Form:</strong> Limpia todo (fechas, tracks, jugadas).<br>
        <em>Sugerencia:</em> Tras llenar tus jugadas, pulsa “Generate Ticket” para ver la ventana de pre-ticket con QR.</p>
      `
    },
    {
      title: '4. Ventana “Wizard” (Entrada Rápida)',
      intro: `
        <p>Se abre con el botón “Wizard” y sirve para agilizar la creación de múltiples jugadas.</p>
        <p>4.1. <strong>Campos Principales</strong><br>
        - <strong>Bet Number + “Add & Next”:</strong> Introduce 2–4 dígitos o un Pale. Pulsa “Add & Next” y se crea una fila interna.<br>
        - <strong>Straight, Box, Combo + candados:</strong> Permite bloquear (“lock”) un monto para repetirlo en cada jugada posterior. Ej. si siempre usas 5.00 en Straight.<br>
        - <strong>Botón “Add Main”:</strong> Pasa todas las jugadas de la tabla interna a la tabla principal.<br>
        - <strong>Botón “Generate”:</strong> Hace “Add All To Main” y luego lanza el “Generate Ticket” final.<br>
        - <strong>Botón “Edit Main”:</strong> Cierra la ventana y vuelve al formulario principal sin generar ticket.</p>
        <p>4.2. <strong>Secciones Extra</strong><br>
        - <strong>Quick Pick:</strong> Elige la modalidad (Pick 3, Win 4, Single Action, NY Horses...), la cantidad de jugadas, y genera números aleatorios.<br>
        - <strong>Permute:</strong> Reordena (baraja) los dígitos de las jugadas ya generadas en el Wizard.<br>
        - <strong>Round Down:</strong> Introduce un rango (ej. 120 a 129) y genera todas las consecutivas. Cada una detecta su modo de juego automáticamente.<br>
        </p>
        <p>4.3. <strong>Eliminar Jugadas en el Wizard</strong><br>
        - Cada fila tiene un botón rojo con el número de la jugada, que puede usarse para remover una jugada individual.</p>
        <p>4.4. <strong>Pasar las Jugadas al Formulario Principal</strong><br>
        - Usa “Add Main” para volcarlas a la tabla principal, o “Generate” para crear el ticket directo.</p>
      `
    },
    {
      title: 'Generar Ticket: Vista Previa',
      intro: `
        <p>Al hacer clic en “Generate Ticket”, aparece una ventana de <strong>Pre Ticket</strong> o vista previa, con todas tus jugadas, el monto total, la fecha(s) y los tracks. Allí puedes:</p>
        <ul>
          <li><strong>Edit:</strong> Regresar al formulario principal para corregir lo necesario.</li>
          <li><strong>Confirm & Print:</strong> Se genera un número de ticket único y un código QR, se descarga la imagen del ticket y puedes compartirlo.</li>
          <li><strong>Share Ticket:</strong> Botón para compartirlo directamente, o ir a la carpeta de descargas y compartir el archivo.</li>
        </ul>
        <p>Una vez confirmado, se bloquea la edición y el ticket queda con su número único.</p>
      `
    }
  ];

  const tutorialStepsHT = [
    {
      element: '#fecha',
      title: 'Dat Pari',
      intro: 'Chwazi youn oswa plizyè dat; jodi a se auto.'
    },
    {
      element: '.accordion',
      title: 'Tracks',
      intro: 'Chwazi kous ou vle (USA, RD). E pèmèt Venezuela si ou vle Pale-Ven.'
    },
    {
      element: '#jugadasTable',
      title: 'Tab Pari',
      intro: 'Antre Bet Number (2–4 chif, oswa Pale). Straight, Box, Combo.'
    },
    {
      element: '#wizardButton',
      title: 'Bouton Wizard',
      intro: 'Louvri fenèt antre rapid. Aprann plis.'
    },
    {
      title: 'Wizard (Kout rèsume)',
      intro: 'Ajoute plizyè parye vit, lock Straight, Box, Combo, Quick Pick...'
    },
    {
      element: '#wizardGenerateTicket',
      title: 'Generate (Wizard)',
      intro: 'Ou ka kreye tikè dirèkteman la.'
    },
    {
      element: '#generarTicket',
      title: 'Generate Ticket',
      intro: 'Apre sa, ou wè Vista Previa tikè a, confirm/print/share.'
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
  // MANUAL DETALLADO
  // =========================================================
  // En #manualEnglishText => texto resumido, #manualCreoleText => lo mismo,
  // En #manualSpanishText => el texto grande y corregido.

  const manualEnglishHTML = `
    <h4>Lottery App Manual (English, short version)</h4>
    <p>Please refer to the tutorial (Help button “E”) for a step-by-step guide.</p>
  `;
  const manualCreoleHTML = `
    <h4>Manyèl (Kreyòl, vèsyon kout)</h4>
    <p>Tanpri itilize bouton “C” pou tutoriel an kreyòl.</p>
  `;

  // Aquí el manual extenso en español con las correcciones solicitadas
  const manualSpanishHTML = `
    <h4>Manual Completo de la App de Loterías (Español)</h4>

    <p><strong>1. Calendario (Selección de Fechas)</strong><br>
    <u>Ubicación:</u> Parte superior. Puede marcar varias fechas, hoy se asigna por defecto, etc.
    El total se multiplica por cada fecha marcada.</p>

    <p><strong>2. Selección de Tracks</strong><br>
    Dos acordeones: “USA” y “Santo Domingo.” El sistema selecciona por defecto un track de New York si ninguno está marcado.
    Marcar tracks (excepto “Venezuela”) aumenta el multiplicador de su total.
    “Venezuela” se combina con un track USA para “Venezuela” (2 dígitos) o “Pale-Ven” (22-50).
    Tracks de RD se marcan solos para “RD-Quiniela” o “Pale-RD.”</p>

    <p><strong>3. Formulario Principal</strong><br>
    - Cada fila tiene <em>Bet Number</em> (2, 3 o 4 dígitos o Pale).<br>
    - <em>Straight, Box, Combo:</em> montos de apuesta.<br>
    - <em>Brooklyn / Front</em>: requieren 3 dígitos (son 3 dígitos finales o iniciales del Win4 de NY).
    <br><strong>Botones:</strong><br>
    <em>Add Play</em> (agrega fila), <em>Wizard</em> (ventana rápida), <em>Remove Last</em> (quita la última fila),
    <em>Reset Form</em> (limpia todo). Al terminar, “Generate Ticket” abre una <u>ventana de pre-ticket</u>
    con la vista previa, donde puede editar antes de confirmar, o confirmar y obtener un ticket con QR.</p>

    <p><strong>4. Ventana “Wizard”</strong><br>
    - Aquí puede ingresar varias jugadas en bloque.<br>
    - <em>Bet Number + Add & Next</em>: añade jugada a la tabla interna.<br>
    - Candados en <em>Straight, Box, Combo</em> para repetir esos montos sin reescribir.<br>
    - <em>Quick Pick</em> (Pick 3, Win 4, Single Action, NY Horses...), <em>Round Down</em> (rango consecutivo),
      <em>Permute</em> (reordena dígitos).<br>
    - Botón rojo con número de jugada => elimina esa jugada individual.<br>
    - <em>Add Main</em> => pasa todo a la tabla principal. <em>Generate</em> => crea el ticket inmediatamente.</p>

    <p><strong>Modalidades Especiales:</strong><br>
    - <em>Single Action</em>: 1 dígito en tracks USA (excepto “Venezuela” / “NY Horses”).<br>
    - <em>NY Horses</em>: (1–4 dígitos) si marca “New York Horses.”<br>
    - <em>Pulito</em> (2 dígitos, track USA), con posiciones en Box para multiplicar.<br>
    - <em>Venezuela</em> (2 dígitos, track “Venezuela” + USA).<br>
    </p>

    <p><strong>5. Límites de Apuesta</strong><br>
    - Win4: Straight máx. 6, Combo máx. 6, Box máx. 40<br>
    - Pick3: Straight y Combo máx. 35, Box máx. 100<br>
    - Venezuela (2 dígitos) y Pulito: Straight máx. 100<br>
    (El sistema le avisará si excede, al generar el ticket.)</p>

    <p><strong>6. Generar Ticket: Vista Previa y Confirmación</strong><br>
    - Al pulsar “Generate Ticket,” aparece la ventana de <em>pre-ticket</em> con tus jugadas, fecha, tracks y total.<br>
    - Si algo está mal, pulsa “Edit” para volver al formulario.<br>
    - Al confirmar, se asigna un número de ticket único y un código QR. Se descarga la imagen del ticket y puede
      compartirlo desde la misma ventana (botón “Share Ticket”) o desde su carpeta de descargas.<br>
    - Si cierra sin confirmar, puede volver a la tabla principal y modificar jugadas libremente.<br>
    </p>
  `;

  $("#manualEnglishText").html(manualEnglishHTML);
  $("#manualSpanishText").html(manualSpanishHTML);
  $("#manualCreoleText").html(manualCreoleHTML);

  // Ocultar ES y HT al inicio, mostrar EN o lo que desees
  $("#manualSpanishText").addClass("d-none");
  $("#manualCreoleText").addClass("d-none");

  // Botones para mostrar/ocultar manual
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
