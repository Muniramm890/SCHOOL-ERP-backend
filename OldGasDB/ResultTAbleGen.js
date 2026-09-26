/**
 * ============================================================================
 * TEST BENCH: SINGLE MATRIX EXPANSION TESTER
 * Executes the complete engine flow for Class 6-A to test append logic
 * ============================================================================
 */
function testJuniorBlockCreation() {
  Logger.log("🏁 Starting Sandbox Test for Single Class & Section...");
  
  // 1. Mock parameters matching frontend payload structure
  const mockExamName = "SANDBOX TEST EXAM";
  const targetClass = "6";
  const targetSection = "A";
  
  try {
    const db0 = getDB0();
    const db1 = getDB1();
    const db3 = getDB3();
    const config = getMasterConfig();
    
    const sh = db0.getSheetByName("Master_Config");
    if (!sh) throw new Error("Master_Config tab missing in DB0");

    // 2. Fetch Roster Matrix from Master_Config (Row 5 to 22, Col Q to AL)
    const academicRaw = sh.getRange(5, 17, 18, 22).getValues();
    let classConfig = null;

    // Scan for Class 6 configuration data
    for (let r = 0; r < academicRaw.length; r++) {
      let currentCls = String(academicRaw[r][0]).trim();
      if (parseInt(currentCls) === parseInt(targetClass) || currentCls === targetClass) {
        
        // Execute Blank Cell Boundary Splitter logic
        const mainSubs = [];
        const skillSubs = [];
        let hitBlankBoundary = false;
        const subjectsRowData = academicRaw[r].slice(2); // Skip Class & Sections

        for (let sIdx = 0; sIdx < subjectsRowData.length; sIdx++) {
          const currentSub = String(subjectsRowData[sIdx] || "").trim();
          if (currentSub === "" || currentSub === "N/A" || currentSub === "0" || currentSub === "FALSE") {
            hitBlankBoundary = true; 
            continue; 
          }
          if (!hitBlankBoundary) mainSubs.push(currentSub);
          else skillSubs.push(currentSub);
        }
        
        classConfig = { mainSubs: mainSubs, skillSubs: skillSubs };
        break;
      }
    }

    if (!classConfig) {
      Logger.log(`❌ Test Cancelled: Config map for Class ${targetClass} not found in DB0.`);
      return;
    }

    // 3. Fetch Live Students list from DB1
    const studentSheet = db1.getSheetByName("Student_Data");
    if (!studentSheet) throw new Error("Student_Data tab missing in DB1");
    const studentRawData = studentSheet.getRange(6, 1, studentSheet.getLastRow() - 5, 7).getValues();

    const targetStudents = studentRawData.filter(r => {
      let c = String(r[5] || "").trim();
      let s = String(r[6] || "").trim().toUpperCase();
      return (c == targetClass || c == targetClass+"th") && s == targetSection;
    }).map(r => ({ id: r[0], roll: Number(r[1] || 0), name: r[2] })).sort((a, b) => a.roll - b.roll);

    if (targetStudents.length === 0) {
      Logger.log(`❌ Test Cancelled: No live students found for ${targetClass}-${targetSection} in DB1.`);
      return;
    }

    // 4. Open/Create destination sheet in DB3 Results database
    const sheetName = `${targetClass}${targetSection}-${config.currentSession}`;
    let targetSheet = db3.getSheetByName(sheetName);
    if (!targetSheet) {
      targetSheet = db3.insertSheet(sheetName);
      let maxC = targetSheet.getMaxColumns();
      if (maxC < 150) targetSheet.insertColumnsAfter(maxC, 150 - maxC);
    }

    // 5. Calculate safe Horizontal Column index
    const lastCol = targetSheet.getLastColumn();
    const sCol = lastCol <= 3 ? 1 : lastCol + 3; // If sheet has data, leave 2 empty columns gap

    Logger.log(`⚙️ Routing to Junior Engine -> Start Column: ${sCol} | Main Subs: ${classConfig.mainSubs.length} | Skill Subs: ${classConfig.skillSubs.length}`);

    // 🚀 6. HIT TRIGGER: Launch independent Junior Builder
    const blockWidth = buildDynamicJuniorBlock(
      targetSheet, 
      sCol, 
      mockExamName, 
      targetStudents, 
      classConfig.mainSubs, 
      classConfig.skillSubs, 
      config
    );

    // Enforce row dimensions consistency
    targetSheet.setRowHeight(1, 65);
    targetSheet.setRowHeight(2, 45);
    targetSheet.setRowHeight(4, 25);
    targetSheet.setRowHeight(5, 25);
    targetSheet.getRange(1, sCol, 5, blockWidth).setFontFamily("Outfit").setVerticalAlignment("middle");

    Logger.log(`🎯 SUCCESS: Independent Table successfully appended horizontally from Column Index: ${sCol} to ${sCol + blockWidth - 1}`);

  } catch (error) {
    Logger.log("❌ Sandbox Test Failed: " + error.toString());
  }
}
/**
 * ============================================================================
 * TEST BENCH: SENIOR MATRIX EXPANSION TESTER
 * Explicitly targets Class 9/10 to validate sub-subjects and senior engine
 * ============================================================================
 */
function testSeniorBlockCreation() {
  Logger.log("🏁 Starting Sandbox Test for Senior Class & Section (9-10)...");
  
  // 1. Mock parameters matching senior frontend payload structure
  const mockExamName = "SENIOR SANDBOX EXAM";
  const targetClass = "9"; // कक्षा 9 या 10 टेस्ट करने के लिए
  const targetSection = "A";
  
  try {
    const db0 = getDB0();
    const db1 = getDB1();
    const db3 = getDB3();
    const config = getMasterConfig();
    
    const sh = db0.getSheetByName("Master_Config");
    if (!sh) throw new Error("Master_Config tab missing in DB0");

    // 2. Fetch Roster Matrix from Master_Config
    const academicRaw = sh.getRange(5, 17, 18, 22).getValues();
    let classConfig = null;

    for (let r = 0; r < academicRaw.length; r++) {
      let currentCls = String(academicRaw[r][0]).trim();
      if (parseInt(currentCls) === parseInt(targetClass) || currentCls === targetClass) {
        
        const mainSubs = [];
        const skillSubs = [];
        let hitBlankBoundary = false;
        const subjectsRowData = academicRaw[r].slice(2); 

        for (let sIdx = 0; sIdx < subjectsRowData.length; sIdx++) {
          const currentSub = String(subjectsRowData[sIdx] || "").trim();
          if (currentSub === "" || currentSub === "N/A" || currentSub === "0" || currentSub === "FALSE") {
            hitBlankBoundary = true; 
            continue; 
          }
          if (!hitBlankBoundary) mainSubs.push(currentSub);
          else skillSubs.push(currentSub);
        }
        
        classConfig = { mainSubs: mainSubs, skillSubs: skillSubs };
        break;
      }
    }

    if (!classConfig) {
      Logger.log(`❌ Test Cancelled: Config map for Class ${targetClass} not found in DB0.`);
      return;
    }

    // 3. Fetch Live Students list from DB1
    const studentSheet = db1.getSheetByName("Student_Data");
    if (!studentSheet) throw new Error("Student_Data tab missing in DB1");
    const studentRawData = studentSheet.getRange(6, 1, studentSheet.getLastRow() - 5, 7).getValues();

    const targetStudents = studentRawData.filter(r => {
      let c = String(r[5] || "").trim();
      let s = String(r[6] || "").trim().toUpperCase();
      return (c == targetClass || c == targetClass+"th") && s == targetSection;
    }).map(r => ({ id: r[0], roll: Number(r[1] || 0), name: r[2] })).sort((a, b) => a.roll - b.roll);

    if (targetStudents.length === 0) {
      Logger.log(`❌ Test Cancelled: No live students found for ${targetClass}-${targetSection} in DB1.`);
      return;
    }

    // 4. Open/Create destination sheet in DB3 Results database
    const sheetName = `${targetClass}${targetSection}-${config.currentSession}`;
    let targetSheet = db3.getSheetByName(sheetName);
    if (!targetSheet) {
      targetSheet = db3.insertSheet(sheetName);
      let maxC = targetSheet.getMaxColumns();
      if (maxC < 150) targetSheet.insertColumnsAfter(maxC, 150 - maxC);
    }

    // 5. Calculate safe Horizontal Column index
    const lastCol = targetSheet.getLastColumn();
    const sCol = lastCol <= 3 ? 1 : lastCol + 3; 

    Logger.log(`⚙️ Routing to Senior Engine Directly -> Start Column: ${sCol} | Main Subs: ${classConfig.mainSubs.length} | Skill Subs: ${classConfig.skillSubs.length}`);

    // 🚀 6. HIT TRIGGER: Launch independent Senior Builder
    const blockWidth = buildDynamicSeniorBlock(
      targetSheet, 
      sCol, 
      mockExamName, 
      targetStudents, 
      classConfig.mainSubs, 
      classConfig.skillSubs, 
      config
    );

    // Enforce row dimensions consistency
    targetSheet.setRowHeight(1, 65);
    targetSheet.setRowHeight(2, 45);
    targetSheet.setRowHeight(4, 25);
    targetSheet.setRowHeight(5, 25);
    targetSheet.getRange(1, sCol, 5, blockWidth).setFontFamily("Outfit").setVerticalAlignment("middle");

    Logger.log(`🎯 SUCCESS: Senior Table successfully appended horizontally from Column Index: ${sCol} to ${sCol + blockWidth - 1}`);

  } catch (error) {
    Logger.log("❌ Senior Sandbox Test Failed: " + error.toString());
  }
}

/**
 * ============================================================================
 * TEST BENCH 3: SR. SEC SCIENCE MATRIX EXPANSION TESTER
 * Explicitly targets Class 11-A / 12-A to validate Core + Math/Bio MAX() Engine
 * ============================================================================
 */
function testSrSecScienceBlockCreation() {
  Logger.log("🏁 Starting Sandbox Test for Sr. Sec Science (11-A)...");
  
  const mockExamName = "SCIENCE SANDBOX EXAM";
  const targetClass = "11"; // 11 या 12 टेस्ट करने के लिए
  const targetSection = "A"; // A = Science
  
  try {
    const db1 = getDB1(); 
    const studentDB = getDB1(); 
    const db3 = getDB3();
    const config = getMasterConfig();
    
    // 1. Mock Subjects for Science (Standard Combo)
    const mainSubs = ["Hindi", "English", "Physics", "Chemistry", "Maths", "Biology"];
    const skillSubs = ["Skill"];

    // 2. Fetch Live Students list
    const studentSheet = studentDB.getSheetByName("Student_Data");
    if (!studentSheet) throw new Error("Student_Data tab missing!");
    // 🧹 SAFE FETCH: अगर शीट में कोई डेटा नहीं है तो यह क्रैश नहीं होगा
    const lastRow = studentSheet.getLastRow();
    if (lastRow < 6) {
      Logger.log("❌ Test Cancelled: Student_Data sheet बिल्कुल खाली है (कोई स्टूडेंट नहीं है)!");
      return;
    }
    
    // सिर्फ Class और Section (जैसे 11 और A) के आधार पर डेटा निकलेगा
    const studentRawData = studentSheet.getRange(6, 1, lastRow - 5, 7).getValues();

    const targetStudents = studentRawData.filter(r => {
      let c = String(r[5] || "").trim();
      let s = String(r[6] || "").trim().toUpperCase();
      return (c == targetClass || c == targetClass+"th") && s == targetSection;
    }).map(r => ({ id: r[0], roll: Number(r[1] || 0), name: r[2] })).sort((a, b) => a.roll - b.roll);

    if (targetStudents.length === 0) {
      Logger.log(`❌ Test Cancelled: No live students found for ${targetClass}-${targetSection}.`);
      return;
    }

    // 3. Open/Create destination sheet in DB3 Results database
    const sheetName = `${targetClass}${targetSection}-${config.currentSession}`;
    let targetSheet = db3.getSheetByName(sheetName);
    if (!targetSheet) {
      targetSheet = db3.insertSheet(sheetName);
      let maxC = targetSheet.getMaxColumns();
      if (maxC < 150) targetSheet.insertColumnsAfter(maxC, 150 - maxC);
    }

    // 4. Calculate safe Horizontal Column index
    const lastCol = targetSheet.getLastColumn();
    const sCol = lastCol <= 3 ? 1 : lastCol + 3; 

    Logger.log(`⚙️ Routing to Science Engine -> Start Column: ${sCol}`);

    // 🚀 5. HIT TRIGGER: Launch Science Builder
    const blockWidth = buildDynamicSrSecScienceBlock(
      targetSheet, 
      sCol, 
      mockExamName, 
      targetStudents, 
      mainSubs, 
      skillSubs, 
      config
    );

    // Enforce row dimensions consistency
    targetSheet.setRowHeight(1, 65);
    targetSheet.setRowHeight(2, 45);
    targetSheet.setRowHeight(4, 25);
    targetSheet.setRowHeight(5, 25);
    targetSheet.getRange(1, sCol, 5, blockWidth).setFontFamily("Outfit").setVerticalAlignment("middle");

    Logger.log(`🎯 SUCCESS: Science Table successfully appended horizontally from Column Index: ${sCol}`);

  } catch (error) {
    Logger.log("❌ Science Sandbox Test Failed: " + error.toString());
  }
}


/**
 * ============================================================================
 * TEST BENCH 4: SR. SEC ARTS MATRIX EXPANSION TESTER
 * Explicitly targets Class 11-B / 12-B to validate Standard SUM Engine
 * ============================================================================
 */
function testSrSecArtsBlockCreation() {
  Logger.log("🏁 Starting Sandbox Test for Sr. Sec Arts (11-B)...");
  
  const mockExamName = "ARTS SANDBOX EXAM";
  const targetClass = "11"; // 11 या 12
  const targetSection = "B"; // B = Arts
  
  try {
    const studentDB = getDB1(); 
    const db3 = getDB3();
    const config = getMasterConfig();
    
    // 1. Mock Subjects for Arts
    const mainSubs = ["Hindi", "English", "History", "Geography", "Economics"];
    const skillSubs = ["Skill"];

    // 2. Fetch Live Students list
    const studentSheet = studentDB.getSheetByName("Student_Data");
    if (!studentSheet) throw new Error("Student_Data tab missing!");
    // 🧹 SAFE FETCH: अगर शीट में कोई डेटा नहीं है तो यह क्रैश नहीं होगा
    const lastRow = studentSheet.getLastRow();
    if (lastRow < 6) {
      Logger.log("❌ Test Cancelled: Student_Data sheet बिल्कुल खाली है (कोई स्टूडेंट नहीं है)!");
      return;
    }
    
    // सिर्फ Class और Section (जैसे 11 और A) के आधार पर डेटा निकलेगा
    const studentRawData = studentSheet.getRange(6, 1, lastRow - 5, 7).getValues();

    const targetStudents = studentRawData.filter(r => {
      let c = String(r[5] || "").trim();
      let s = String(r[6] || "").trim().toUpperCase();
      return (c == targetClass || c == targetClass+"th") && s == targetSection;
    }).map(r => ({ id: r[0], roll: Number(r[1] || 0), name: r[2] })).sort((a, b) => a.roll - b.roll);

    if (targetStudents.length === 0) {
      Logger.log(`❌ Test Cancelled: No live students found for ${targetClass}-${targetSection}.`);
      return;
    }

    // 3. Open/Create destination sheet in DB3 Results database
    const sheetName = `${targetClass}${targetSection}-${config.currentSession}`;
    let targetSheet = db3.getSheetByName(sheetName);
    if (!targetSheet) {
      targetSheet = db3.insertSheet(sheetName);
      let maxC = targetSheet.getMaxColumns();
      if (maxC < 150) targetSheet.insertColumnsAfter(maxC, 150 - maxC);
    }

    // 4. Calculate safe Horizontal Column index
    const lastCol = targetSheet.getLastColumn();
    const sCol = lastCol <= 3 ? 1 : lastCol + 3; 

    Logger.log(`⚙️ Routing to Arts Engine -> Start Column: ${sCol}`);

    // 🚀 5. HIT TRIGGER: Launch Arts Builder
    const blockWidth = buildDynamicSrSecArtsBlock(
      targetSheet, 
      sCol, 
      mockExamName, 
      targetStudents, 
      mainSubs, 
      skillSubs, 
      config
    );

    // Enforce row dimensions consistency
    targetSheet.setRowHeight(1, 65);
    targetSheet.setRowHeight(2, 45);
    targetSheet.setRowHeight(4, 25);
    targetSheet.setRowHeight(5, 25);
    targetSheet.getRange(1, sCol, 5, blockWidth).setFontFamily("Outfit").setVerticalAlignment("middle");

    Logger.log(`🎯 SUCCESS: Arts Table successfully appended horizontally from Column Index: ${sCol}`);

  } catch (error) {
    Logger.log("❌ Arts Sandbox Test Failed: " + error.toString());
  }
}

/**
 * ============================================================================
 * NEW HELPER: APPLY JUNIOR SPECIFIC BORDERS & CONDITIONAL FORMATTING
 * 100% Crash-Proof, handles high column matrix and prevents merged cell errors
 * ============================================================================
 */

function buildDynamicJuniorBlock(sheet, sCol, exName, students, mainSubs, skillSubs, config) {
  const bW = 3 + mainSubs.length + skillSubs.length + 3; 
  
  const requiredTotalCols = sCol + bW + 2; 
  prepareSheetColumns(sheet, requiredTotalCols);

  const rDataS = 6;
  const totalSt = students.length;
  const rDataEnd = rDataS + totalSt - 1;
  const rMaxM = rDataEnd + 1;
  const rStatS = rMaxM + 2; 
  const finalBlockMaxRow = rStatS + 9;


  const cleanStartCol = sCol > 1 ? (sCol - 2) : sCol;
  const cleanWidth = (sCol + bW - 1) - cleanStartCol + 1;
  
  // 1. गैप और पूरी नई टेबल के एरिया को एक साथ वाइट (White) कर दें
  sheet.getRange(1, cleanStartCol, finalBlockMaxRow, cleanWidth)
       .setBackground("#ffffff")
       .setBorder(false, false, false, false, false, false);

  // 2. गैप कॉलम्स में अगर कुछ टेक्स्ट आ गया हो, तो सिर्फ उसे क्लियर करें
  if (sCol > 1) {
    sheet.getRange(1, sCol - 2, finalBlockMaxRow, 2).clearContent();
  }
  // 🧹 NEW FIX (ONLY FOR COLORS): नई टेबल के एरिया से स्ट्रेच हुए पुराने कलर को रिसेट करने के लिए
  sheet.getRange(1, sCol, finalBlockMaxRow, bW).setBackground("#ffffff");

  // ── baaki poora function bilkul waisa hi ──
  const PALETTE = {
    ID_PANE: "#1e3a8a", ID_TEXT: "#ffffff", ID_SUB: "#374151",
    MAIN_CAT: "#065f46", MAIN_HEAD: "#d1fae5", MAIN_TEXT: "#065f46", MAIN_CELL: "#f0fdf4",
    SKILL_CAT: "#92400e", SKILL_HEAD: "#ffedd5", SKILL_TEXT: "#92400e", SKILL_CELL: "#fff7ed",
    RES_CAT: "#5b21b6", RES_HEAD: "#ede9fe", RES_TEXT: "#5b21b6", RES_CELL: "#f5f3ff",
    MAX_BG: "#fef3c7", MAX_TEXT: "#92400e"
  };

  sheet.getRange(1, sCol, 2, 3).merge()
       .setValue(`CLASS REGISTER\n${exName}`)
       .setBackground(PALETTE.ID_PANE).setFontColor(PALETTE.ID_TEXT).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(11).setWrap(true);
       
  sheet.getRange(4, sCol, 1, 3).merge().setValue("STUDENT IDENTITY")
       .setBackground(PALETTE.ID_SUB).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
       
  sheet.getRange(5, sCol, 1, 3).setValues([["UID", "Roll No", "Name"]])
       .setBackground("#f8fafc").setFontWeight("bold").setHorizontalAlignment("center").setFontColor("#64748b").setFontSize(9);
  
  const idRows = students.map(s => [s.id, s.roll, s.name]);
  sheet.getRange(rDataS, sCol, totalSt, 3).setValues(idRows).setBackground("#ffffff").setFontWeight("bold").setFontSize(9).setFontColor("#1e293b");

  const cM = sCol + 3;                   
  const cME = cM + mainSubs.length - 1;  
  const cS = cME + 1;                    
  const cSE = cS + skillSubs.length - 1; 
  const cR = cSE + 1;                    

  sheet.getRange(1, cM, 1, bW - 3).merge().setValue(config.schoolNameBig.toUpperCase())
       .setBackground("#065f46").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontSize(18);
       
  sheet.getRange(2, cM, 1, bW - 3).merge().setValue(exName)
       .setBackground("#d35400").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontSize(11);

  sheet.getRange(4, cM, 1, mainSubs.length).merge().setValue("MAIN").setBackground(PALETTE.MAIN_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
  if(skillSubs.length > 0) {
    sheet.getRange(4, cS, 1, skillSubs.length).merge().setValue("SKILL").setBackground(PALETTE.SKILL_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
  }
  sheet.getRange(4, cR, 1, 3).merge().setValue("RESULT").setBackground(PALETTE.RES_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);

  const headers = mainSubs.concat(skillSubs).concat(["TOT", "%", "RNK"]);
  sheet.getRange(5, cM, 1, headers.length).setValues([headers]).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(9).setFontColor("#0f172a");
  
  sheet.getRange(5, cM, 1, mainSubs.length).setBackground(PALETTE.MAIN_HEAD).setFontColor(PALETTE.MAIN_TEXT);
  if(skillSubs.length > 0) sheet.getRange(5, cS, 1, skillSubs.length).setBackground(PALETTE.SKILL_HEAD).setFontColor(PALETTE.SKILL_TEXT);
  sheet.getRange(5, cR, 1, 3).setBackground(PALETTE.RES_HEAD).setFontColor(PALETTE.RES_TEXT);

  const maxMarksValues = mainSubs.map(() => 80).concat(skillSubs.map(() => 40)).concat(["", "", ""]);
  sheet.getRange(rMaxM, cM, 1, headers.length).setValues([maxMarksValues]).setFontWeight("bold").setHorizontalAlignment("center").setBackground(PALETTE.MAX_BG).setFontColor(PALETTE.MAX_TEXT).setFontSize(9);
  sheet.getRange(rMaxM, sCol, 1, 3).merge().setValue("MAX MARKS").setBackground(PALETTE.MAX_BG).setFontColor(PALETTE.MAX_TEXT).setFontWeight("bold").setHorizontalAlignment("right").setFontSize(9);

  const bodyFormulas = [];
  for (let i = 0; i < totalSt; i++) {
    let row = rDataS + i;
    let mainRangeFormula = `${colToLet(cM)}${row}:${colToLet(cME)}${row}`;
    
    let fTotal = `=IF(COUNT(${mainRangeFormula})=0, "", SUM(${mainRangeFormula}))`;
    let fPct = `=IFERROR(ROUND((${colToLet(cR)}${row} / SUM(${colToLet(cM)}$${rMaxM}:${colToLet(cME)}$${rMaxM}))*100, 1), "")`;
    let fRank = `=IFERROR(RANK(${colToLet(cR+1)}${row}, ${colToLet(cR+1)}$${rDataS}:${colToLet(cR+1)}$${rDataEnd}), "")`;
    
    bodyFormulas.push([fTotal, fPct, fRank]);
  }
  sheet.getRange(rDataS, cR, totalSt, 3).setValues(bodyFormulas).setBackground(PALETTE.RES_CELL).setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);

  sheet.getRange(rDataS, cM, totalSt, mainSubs.length).setBackground(PALETTE.MAIN_CELL);
  if(skillSubs.length > 0) sheet.getRange(rDataS, cS, totalSt, skillSubs.length).setBackground(PALETTE.SKILL_CELL);

  const allSubs = mainSubs.concat(skillSubs).concat(["TOT"]);
  
  allSubs.forEach((sub, idx) => {
    let col = cM + idx;
    let colL = colToLet(col);
    let dR = `${colL}${rDataS}:${colL}${rDataEnd}`;
    let mRef = `${colL}${rMaxM}`;
    
    let statFormulas = [
      [`=COUNTA(${colToLet(sCol+2)}${rDataS}:${colToLet(sCol+2)}${rDataEnd})`],
      [`=COUNT(${dR})`],
      [`=COUNTIF(${dR}, ">="&(${mRef}*0.33))`],
      [`=IF(COUNT(${dR})=0, 0, COUNTIF(${dR}, "<"&(${mRef}*0.33)) - COUNTIF(${dR}, "AB"))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.33), ${dR}, "<"&(${mRef}*0.60))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.60), ${dR}, "<"&(${mRef}*0.75))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.75), ${dR}, "<"&(${mRef}*0.90))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.90), ${dR}, "<="&(${mRef}*0.95))`],
      [`=COUNTIF(${dR}, ">"&(${mRef}*0.95))`],
      [`=IFERROR(ROUND(AVERAGE(${dR}), 1), 0)`]
    ];
    
    let statsRange = sheet.getRange(rStatS, col, 10, 1);
    statsRange.setFormulas(statFormulas).setHorizontalAlignment("center").setFontSize(8).setFontWeight("bold");
    
    for(let fR = 0; fR < 10; fR++) {
      let bg = (fR % 2 == 0) ? "#f8fafc" : "#ffffff";
      sheet.getRange(rStatS + fR, col).setBackground(bg);
    }
    sheet.getRange(rStatS + 2, col).setFontColor("#15803d");
    sheet.getRange(rStatS + 3, col).setFontColor("#b91c1c");
    sheet.getRange(rStatS + 9, col).setBackground("#f0fdf4").setFontColor("#16a34a").setFontSize(9);
  });

  let labels = [["TOTAL STUDENTS"], ["APPEARED"], ["PASS (≥33%)"], ["FAIL (<33%)"], ["33-59%"], ["60-74%"], ["75-89%"], ["90-95%"], [">95%"], ["SUBJECT AVG"]];
  
  for (let rOffset = 0; rOffset < 10; rOffset++) {
    sheet.getRange(rStatS + rOffset, sCol, 1, 3).merge();
  }
  
  sheet.getRange(rStatS, sCol, 10, 1)
       .setValues(labels)
       .setFontWeight("bold")
       .setHorizontalAlignment("right")
       .setBackground("#0f172a")
       .setFontColor("white")
       .setFontSize(8);

  for(let rIdx = 0; rIdx < 10; rIdx++){
    sheet.setRowHeight(rStatS + rIdx, 20);
  }

  applyJuniorBlockBordersAndCF(sheet, sCol, bW, rDataS, totalSt, rMaxM, cR, rStatS);
  return bW;
}


function applyJuniorBlockBordersAndCF(sheet, sCol, bW, rDataS, totalSt, rMaxM, cR, rStatS) {
  const rules = sheet.getConditionalFormatRules();
  
  // रेंज निर्धारण: केवल डेटा रोज़ के मार्क्स इनपुट एरिया को टारगेट करना
  const blockDataRange = sheet.getRange(rDataS, sCol + 3, totalSt, bW - 6); 
  const pctCellRange = sheet.getRange(rDataS, cR + 1, totalSt, 1);          
  
  // पृथक रेंजेस: मर्ज्ड सेल एरर को रोकने के लिए अलग-अलग असाइनमेंट
  const identityNameRange = sheet.getRange(rDataS, sCol + 2, totalSt, 1); // Student Name Column
  const totColumnRange = sheet.getRange(rDataS, cR, totalSt, 1);          // Only TOT Column
  const pctColumnRange = sheet.getRange(rDataS, cR + 1, totalSt, 1);      // Only % Column
  
  const currentBlockMaxRowRef = colToLet(sCol + 3) + "$" + rMaxM;

  // Rule 1: Fail Overlap (< 33%)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND(ISNUMBER(${colToLet(sCol+3)}${rDataS}), ${colToLet(sCol+3)}${rDataS} < ${currentBlockMaxRowRef}*0.33)`)
    .setBackground("#f87171").setFontColor("#ffffff").setRanges([blockDataRange]).build());

  // Rule 2: Elite Topper (>= 90%)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND(ISNUMBER(${colToLet(sCol+3)}${rDataS}), ${colToLet(sCol+3)}${rDataS} >= ${currentBlockMaxRowRef}*0.90)`)
    .setBackground("#16a34a").setFontColor("#ffffff").setRanges([blockDataRange]).build());

  // Rule 3: Absent Special Token
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("AB").setBackground("#fef08a").setFontColor("#854d0e").setRanges([blockDataRange]).build());

  // Rule 4: % Column Excellence Highlight
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(90).setBackground("#16a34a").setFontColor("#ffffff").setRanges([pctCellRange]).build());

  // 🟢 FIXED: Rank 1, 2, 3 Standings Rules (पुश करने के लिए आइसोलेटेड इंडिविजुअल लूप)
  const rankColLetter = colToLet(cR + 2);
  const ranks = [
    { num: 1, bg: "#fcd34d" }, // Gold
    { num: 2, bg: "#e2e8f0" }, // Silver
    { num: 3, bg: "#fdba74" }  // Bronze
  ];
  
  ranks.forEach(r => {
    const formula = `=$${rankColLetter}${rDataS}=${r.num}`;
    // प्रत्येक रेंज को अलग रूल बनाकर पुश करें ताकि मर्ज्ड सेल एक्सेप्शन ट्रिगर न हो
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(r.bg).setBold(true).setRanges([identityNameRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(r.bg).setBold(true).setRanges([totColumnRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(r.bg).setBold(true).setRanges([pctColumnRange]).build());
  });

  sheet.setConditionalFormatRules(rules);

  // पूरे ग्रिड पर लाइन्स लगाना
  const finalBlockMaxRow = rStatS + 9;
  sheet.getRange(1, sCol, finalBlockMaxRow, bW).setBorder(true, true, true, true, true, true, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
  sheet.setColumnWidths(sCol, bW, 60);
  sheet.setColumnWidth(sCol, 130); 
  sheet.setColumnWidth(sCol + 2, 160); 
}

/**
 * ============================================================================
 * ENGINE 2: SENIOR DYNAMIC INDEPENDENT BLOCK BUILDER (Classes 9-10)
 * Handles sub-subjects (Phy, Chem, Bio -> Sci-Tot) and nested formula rendering
 * ============================================================================
 */

function buildDynamicSeniorBlock(sheet, sCol, exName, students, mainSubs, skillSubs, config) {
  // 📐 Dimension calculations
  const bW = 3 + mainSubs.length + skillSubs.length + 3; 
  
  const requiredTotalCols = sCol + bW + 2; 
  prepareSheetColumns(sheet, requiredTotalCols);

  const rDataS = 6;
  const totalSt = students.length;
  const rDataEnd = rDataS + totalSt - 1;
  const rMaxM = rDataEnd + 1;
  const rStatS = rMaxM + 2; 
  const finalBlockMaxRow = rStatS + 9;

  // 🔧 FIX: Sirf naye block + safe gap columns (sCol-2, sCol-1) ko break karo.
  // sCol-3 (purane block ka EXACT last column) ko bilkul touch mat karo —
  // wahan purane block ka wide "SCHOOL NAME" banner merge khatam hota hai,
  // usse partial-overlap hone par yeh crash deta: "You must select all
  // cells in a merged range to merge or unmerge them."
  // 🧹 100% SAFE FIX: No breakApart(). सिर्फ गैप और बैकग्राउंड को रिसेट करेंगे
  const cleanStartCol = sCol > 1 ? (sCol - 2) : sCol;
  const cleanWidth = (sCol + bW - 1) - cleanStartCol + 1;
  
  // 1. गैप और पूरी नई टेबल के एरिया को एक साथ वाइट (White) कर दें
  sheet.getRange(1, cleanStartCol, finalBlockMaxRow, cleanWidth)
       .setBackground("#ffffff")
       .setBorder(false, false, false, false, false, false);

  // 2. गैप कॉलम्स में अगर कुछ टेक्स्ट आ गया हो, तो सिर्फ उसे क्लियर करें
  if (sCol > 1) {
    sheet.getRange(1, sCol - 2, finalBlockMaxRow, 2).clearContent();
  }
  
  // 3. नई टेबल के एरिया से स्ट्रेच हुए पुराने कलर को रिसेट करने के लिए
  sheet.getRange(1, sCol, finalBlockMaxRow, bW).setBackground("#ffffff");

  // Visual Palette for Senior System (Deep Teal Premium Theme)
  const PALETTE = {
    ID_PANE: "#1e3a8a", ID_TEXT: "#ffffff", ID_SUB: "#374151",
    MAIN_CAT: "#0f766e", MAIN_HEAD: "#ccfbf1", MAIN_TEXT: "#115e59", MAIN_CELL: "#f0fdf4",
    SKILL_CAT: "#b45309", SKILL_HEAD: "#fef3c7", SKILL_TEXT: "#92400e", SKILL_CELL: "#fffbeb",
    RES_CAT: "#6d28d9", RES_HEAD: "#f3e8ff", RES_TEXT: "#5b21b6", RES_CELL: "#faf5ff",
    MAX_BG: "#fee2e2", MAX_TEXT: "#991b1b"
  };

  // ── LAYER 1: INDEPENDENT STUDENT IDENTITY (Columns 1-3) ──
  sheet.getRange(1, sCol, 2, 3).merge()
       .setValue(`CLASS REGISTER\n${exName}`)
       .setBackground(PALETTE.ID_PANE).setFontColor(PALETTE.ID_TEXT).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(11).setWrap(true);
       
  sheet.getRange(4, sCol, 1, 3).merge().setValue("STUDENT IDENTITY")
       .setBackground(PALETTE.ID_SUB).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
       
  sheet.getRange(5, sCol, 1, 3).setValues([["UID", "Roll No", "Name"]])
       .setBackground("#f8fafc").setFontWeight("bold").setHorizontalAlignment("center").setFontColor("#64748b").setFontSize(9);
  
  const idRows = students.map(s => [s.id, s.roll, s.name]);
  sheet.getRange(rDataS, sCol, totalSt, 3).setValues(idRows).setBackground("#ffffff").setFontWeight("bold").setFontSize(9).setFontColor("#1e293b");

  // Dynamic Column Pointers
  const cM = sCol + 3;                   
  const cME = cM + mainSubs.length - 1;  
  const cS = cME + 1;                    
  const cSE = cS + skillSubs.length - 1; 
  const cR = cSE + 1;                    

  // ── LAYER 2: INSTITUTIONAL BRANDING (Premium Green Theme from Junior sync) ──
  sheet.getRange(1, cM, 1, bW - 3).merge().setValue(config.schoolNameBig.toUpperCase())
       .setBackground("#065f46").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontSize(14);
       
  sheet.getRange(2, cM, 1, bW - 3).merge().setValue(exName)
       .setBackground("#d35400").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontSize(11);

  // Row 4 Category Anchors
  sheet.getRange(4, cM, 1, mainSubs.length).merge().setValue("MAIN SUBJECTS").setBackground(PALETTE.MAIN_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
  if(skillSubs.length > 0) {
    sheet.getRange(4, cS, 1, skillSubs.length).merge().setValue("SKILL / INTERNAL").setBackground(PALETTE.SKILL_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
  }
  sheet.getRange(4, cR, 1, 3).merge().setValue("PERFORMANCE").setBackground(PALETTE.RES_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);

  // Row 5 Header Names Injection
  const headers = mainSubs.concat(skillSubs).concat(["TOTAL", "%", "RNK"]);
  sheet.getRange(5, cM, 1, headers.length).setValues([headers]).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(9).setFontColor("#0f172a");
  
  sheet.getRange(5, cM, 1, mainSubs.length).setBackground(PALETTE.MAIN_HEAD).setFontColor(PALETTE.MAIN_TEXT);
  if(skillSubs.length > 0) sheet.getRange(5, cS, 1, skillSubs.length).setBackground(PALETTE.SKILL_HEAD).setFontColor(PALETTE.SKILL_TEXT);
  sheet.getRange(5, cR, 1, 3).setBackground(PALETTE.RES_HEAD).setFontColor(PALETTE.RES_TEXT);

  // ── LAYER 3: DYNAMIC MAX MARKS ASSIGNMENT (Sub-parts allocation) ──
  const subComponentKeywords = ["physics", "chemistry", "biology", "history", "geography", "economics"];
  const maxMarksValues = mainSubs.map(s => {
    let clean = s.toLowerCase().trim();
    if (clean.includes("tot")) return 80;
    if (subComponentKeywords.some(k => clean.includes(k))) return 27; 
    return 80;
  }).concat(skillSubs.map(() => 100)).concat(["", "", ""]);

  sheet.getRange(rMaxM, cM, 1, headers.length).setValues([maxMarksValues]).setFontWeight("bold").setHorizontalAlignment("center").setBackground(PALETTE.MAX_BG).setFontColor(PALETTE.MAX_TEXT).setFontSize(9);
  sheet.getRange(rMaxM, sCol, 1, 3).merge().setValue("MAX MARKS").setBackground(PALETTE.MAX_BG).setFontColor(PALETTE.MAX_TEXT).setFontWeight("bold").setHorizontalAlignment("right").setFontSize(9);

  // ── LAYER 4: COMPLEX NESTED FORMULAS MATRIX (Internal Summing Engine) ──
  const sciIndices = []; 
  let sciTotColIndex = -1; // 🟢 नया: Exact column number सेव करने के लिए
  const sstIndices = []; 
  let sstTotColIndex = -1; // 🟢 नया: Exact column number सेव करने के लिए
  const directSumCols = []; 

  mainSubs.forEach((sub, idx) => {
    let clean = sub.toLowerCase().trim();
    let colNum = cM + idx;
    let colLetter = colToLet(colNum);
    
    if (clean.includes("physics") || clean.includes("chemistry") || clean.includes("biology")) {
      sciIndices.push(colLetter);
    } 
    // 🟢 "science" या "sci-tot" दोनों पर काम करेगा
    else if (clean === "science" || clean.includes("sci-tot") || clean.includes("sci tot")) {
      sciTotColIndex = colNum; 
      directSumCols.push(colLetter); 
    } 
    else if (clean.includes("history") || clean.includes("geography") || clean.includes("economics")) {
      sstIndices.push(colLetter);
    } 
    // 🟢 "social science", "sst", या "sst-tot" सब पर काम करेगा
    else if (clean === "sst" || clean.includes("social") || clean.includes("sst-tot") || clean.includes("sst tot")) {
      sstTotColIndex = colNum; 
      directSumCols.push(colLetter); 
    } 
    else {
      directSumCols.push(colLetter); 
    }
  });

  // Background cell color textures
  sheet.getRange(rDataS, cM, totalSt, mainSubs.length).setBackground(PALETTE.MAIN_CELL);
  if(skillSubs.length > 0) sheet.getRange(rDataS, cS, totalSt, skillSubs.length).setBackground(PALETTE.SKILL_CELL);

  const rowFormulas = [];
  for (let i = 0; i < totalSt; i++) {
    let row = rDataS + i;
    
    // 1. Live Internal Summing for Science Components
    if (sciIndices.length > 0 && sciTotColIndex !== -1) {
      let sciSumFormula = sciIndices.map(c => `${c}${row}`).join('+');
      sheet.getRange(row, sciTotColIndex)
        .setFormula(`=IF(COUNT(${sciIndices.map(c => c+row).join(',')})=0, "", ${sciSumFormula})`)
        .setFontWeight("bold").setFontColor("#0f766e").setHorizontalAlignment("center");
    }
    
    // 2. Live Internal Summing for SST Components
    if (sstIndices.length > 0 && sstTotColIndex !== -1) {
      let sstSumFormula = sstIndices.map(c => `${c}${row}`).join('+');
      sheet.getRange(row, sstTotColIndex)
        .setFormula(`=IF(COUNT(${sstIndices.map(c => c+row).join(',')})=0, "", ${sstSumFormula})`)
        .setFontWeight("bold").setFontColor("#0f766e").setHorizontalAlignment("center");
    }

    // 3. Grand Total Calculation (Only targeting directSumCols, skipping sub-parts)
    let totalTargetCells = directSumCols.map(c => `${c}${row}`).join(',');
    let maxTargetCells = directSumCols.map(c => `${c}$${rMaxM}`).join(',');
    
    let fTotal = `=IF(COUNT(${totalTargetCells})=0, "", SUM(${totalTargetCells}))`;
    let fPct = `=IFERROR(ROUND((${colToLet(cR)}${row} / SUM(${maxTargetCells}))*100, 1), "")`;
    let fRank = `=IFERROR(RANK(${colToLet(cR+1)}${row}, ${colToLet(cR+1)}$${rDataS}:${colToLet(cR+1)}$${rDataEnd}), "")`;
    
    rowFormulas.push([fTotal, fPct, fRank]);
  }
  
  // Inject Final Grand Results Roster Block
  sheet.getRange(rDataS, cR, totalSt, 3).setValues(rowFormulas).setBackground(PALETTE.RES_CELL).setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
  
  // 🟢 Highlight Total Sub columns visually inside the cell grid (Bina 'tot' naam check kiye)
  if (sciTotColIndex !== -1) sheet.getRange(rDataS, sciTotColIndex, totalSt, 1).setBackground("#ccfbf1");
  if (sstTotColIndex !== -1) sheet.getRange(rDataS, sstTotColIndex, totalSt, 1).setBackground("#ccfbf1");

  // ── LAYER 5: KPI STATS FOOTER ENGINE (Formulas & Colors) ──
  const allSubs = mainSubs.concat(skillSubs).concat(["TOTAL"]);
  allSubs.forEach((sub, idx) => {
    let col = cM + idx;
    let colL = colToLet(col);
    let dR = `${colL}${rDataS}:${colL}${rDataEnd}`;
    let mRef = `${colL}${rMaxM}`;
    
    let statFormulas = [
      [`=COUNTA(${colToLet(sCol+2)}${rDataS}:${colToLet(sCol+2)}${rDataEnd})`],
      [`=COUNT(${dR})`],                                                       
      [`=COUNTIF(${dR}, ">="&(${mRef}*0.33))`],                                
      [`=IF(COUNT(${dR})=0, 0, COUNTIF(${dR}, "<"&(${mRef}*0.33)) - COUNTIF(${dR}, "AB"))`], 
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.33), ${dR}, "<"&(${mRef}*0.60))`],    
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.60), ${dR}, "<"&(${mRef}*0.75))`],    
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.75), ${dR}, "<"&(${mRef}*0.90))`],    
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.90), ${dR}, "<="&(${mRef}*0.95))`],   
      [`=COUNTIF(${dR}, ">"&(${mRef}*0.95))`],                                 
      [`=IFERROR(ROUND(AVERAGE(${dR}), 1), 0)`]                                
    ];
    
    let statsRange = sheet.getRange(rStatS, col, 10, 1);
    statsRange.setFormulas(statFormulas).setHorizontalAlignment("center").setFontSize(8).setFontWeight("bold");
    
    for(let fR = 0; fR < 10; fR++) {
      let bg = (fR % 2 == 0) ? "#f8fafc" : "#ffffff";
      sheet.getRange(rStatS + fR, col).setBackground(bg);
    }
    sheet.getRange(rStatS + 2, col).setFontColor("#15803d"); 
    sheet.getRange(rStatS + 3, col).setFontColor("#b91c1c"); 
    sheet.getRange(rStatS + 9, col).setBackground("#ccfbf1").setFontColor("#0f766e").setFontSize(9); 
  });

  // KPI Left Sticky Label Column Merge Block
  let labels = [["TOTAL STUDENTS"], ["APPEARED"], ["PASS (≥33%)"], ["FAIL (<33%)"], ["33-59%"], ["60-74%"], ["75-89%"], ["90-95%"], [">95%"], ["SUBJECT AVG"]];
  for (let rOffset = 0; rOffset < 10; rOffset++) {
    sheet.getRange(rStatS + rOffset, sCol, 1, 3).merge();
  }
  
  sheet.getRange(rStatS, sCol, 10, 1)
       .setValues(labels)
       .setFontWeight("bold")
       .setHorizontalAlignment("right")
       .setBackground("#334155") 
       .setFontColor("white")
       .setFontSize(8);

  for(let rIdx = 0; rIdx < 10; rIdx++){
    sheet.setRowHeight(rStatS + rIdx, 20);
  }

  // ── LAYER 6: ISOLATED CONDITIONAL FORMATTING & GRID BORDERS ──
  // 🟢 CORRECTED: सीनियर इंजन के लिए बिल्कुल सही और आइसोलेटेड सीनियर हेल्पर कॉल
  applySeniorBlockBordersAndCF(sheet, sCol, bW, rDataS, totalSt, rMaxM, cR, rStatS);
  return bW;
}

/**
 * ============================================================================
 * NEW HELPER: APPLY SENIOR SPECIFIC BORDERS & CONDITIONAL FORMATTING
 * 100% Crash-Proof, isolates formulas from footer statistics block flawlessly
 * ============================================================================
 */
function applySeniorBlockBordersAndCF(sheet, sCol, bW, rDataS, totalSt, rMaxM, cR, rStatS) {
  const rules = sheet.getConditionalFormatRules();
  
  const blockDataRange = sheet.getRange(rDataS, sCol + 3, totalSt, bW - 6); 
  const pctCellRange = sheet.getRange(rDataS, cR + 1, totalSt, 1);          
  
  const identityNameRange = sheet.getRange(rDataS, sCol + 2, totalSt, 1); 
  const totColumnRange = sheet.getRange(rDataS, cR, totalSt, 1);          
  const pctColumnRange = sheet.getRange(rDataS, cR + 1, totalSt, 1);      
  
  const currentBlockMaxRowRef = colToLet(sCol + 3) + "$" + rMaxM;

  // Rule 1: Fail Overlap (< 33%)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND(ISNUMBER(${colToLet(sCol+3)}${rDataS}), ${colToLet(sCol+3)}${rDataS} < ${currentBlockMaxRowRef}*0.33)`)
    .setBackground("#f87171").setFontColor("#ffffff").setRanges([blockDataRange]).build());

  // Rule 2: Elite Topper (>= 90%)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND(ISNUMBER(${colToLet(sCol+3)}${rDataS}), ${colToLet(sCol+3)}${rDataS} >= ${currentBlockMaxRowRef}*0.90)`)
    .setBackground("#16a34a").setFontColor("#ffffff").setRanges([blockDataRange]).build());

  // Rule 3: Absent Special Token
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("AB").setBackground("#fef08a").setFontColor("#854d0e").setRanges([blockDataRange]).build());

  // Rule 4: % Column Excellence Highlight
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(90).setBackground("#16a34a").setFontColor("#ffffff").setRanges([pctCellRange]).build());

  // 🟢 FIXED: Rank 1, 2, 3 Standings Rules (Senior के लिए भी लूप आधारित सेफ इंजेक्शन)
  const rankColLetter = colToLet(cR + 2);
  const ranks = [
    { num: 1, bg: "#fcd34d" }, 
    { num: 2, bg: "#e2e8f0" }, 
    { num: 3, bg: "#fdba74" }  
  ];
  
  ranks.forEach(r => {
    const formula = `=$${rankColLetter}${rDataS}=${r.num}`;
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(r.bg).setBold(true).setRanges([identityNameRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(r.bg).setBold(true).setRanges([totColumnRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(r.bg).setBold(true).setRanges([pctColumnRange]).build());
  });

  sheet.setConditionalFormatRules(rules);

  // पूरे सीनियर ग्रिड पर लाइन्स लगाना
  const finalBlockMaxRow = rStatS + 9;
  sheet.getRange(1, sCol, finalBlockMaxRow, bW).setBorder(true, true, true, true, true, true, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
  
  sheet.setColumnWidths(sCol, bW, 60); 
  
 
  sheet.setColumnWidth(sCol, 130); 
  

  sheet.setColumnWidth(sCol + 2, 160);
}

/**
 * ============================================================================
 * ENGINE 3: SR. SECONDARY SCIENCE BLOCK BUILDER (Classes 11-12)
 * Smart Formula: Core Subjects SUM + MAX(Maths, Biology)
 * ============================================================================
 */
function buildDynamicSrSecScienceBlock(sheet, sCol, exName, students, mainSubs, skillSubs, config) {
  const bW = 3 + mainSubs.length + skillSubs.length + 3; 
  
  const requiredTotalCols = sCol + bW + 2; 
  prepareSheetColumns(sheet, requiredTotalCols);

  const rDataS = 6;
  const totalSt = students.length;
  const rDataEnd = rDataS + totalSt - 1;
  const rMaxM = rDataEnd + 1;
  const rStatS = rMaxM + 2; 
  const finalBlockMaxRow = rStatS + 9;

  // 🧹 100% SAFE FIX: No breakApart(). सिर्फ गैप और बैकग्राउंड को रिसेट करेंगे
  const cleanStartCol = sCol > 1 ? (sCol - 2) : sCol;
  const cleanWidth = (sCol + bW - 1) - cleanStartCol + 1;
  
  sheet.getRange(1, cleanStartCol, finalBlockMaxRow, cleanWidth)
       .setBackground("#ffffff")
       .setBorder(false, false, false, false, false, false);

  if (sCol > 1) {
    sheet.getRange(1, sCol - 2, finalBlockMaxRow, 2).clearContent();
  }
  
  sheet.getRange(1, sCol, finalBlockMaxRow, bW).setBackground("#ffffff");

  // 🎨 PALETTE for 11-12 Science (Professional Deep Blue & Amber Theme)
  const PALETTE = {
    ID_PANE: "#1e3a8a", ID_TEXT: "#ffffff", ID_SUB: "#374151",
    MAIN_CAT: "#1e40af", MAIN_HEAD: "#dbeafe", MAIN_TEXT: "#1e40af", MAIN_CELL: "#eff6ff",
    SKILL_CAT: "#92400e", SKILL_HEAD: "#ffedd5", SKILL_TEXT: "#92400e", SKILL_CELL: "#fff7ed",
    RES_CAT: "#5b21b6", RES_HEAD: "#ede9fe", RES_TEXT: "#5b21b6", RES_CELL: "#f5f3ff",
    MAX_BG: "#fef3c7", MAX_TEXT: "#92400e"
  };

  // ── LAYER 1: IDENTITY ──
  sheet.getRange(1, sCol, 2, 3).merge()
       .setValue(`SR. SEC SCIENCE\n${exName}`)
       .setBackground(PALETTE.ID_PANE).setFontColor(PALETTE.ID_TEXT).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(11).setWrap(true);
       
  sheet.getRange(4, sCol, 1, 3).merge().setValue("STUDENT IDENTITY")
       .setBackground(PALETTE.ID_SUB).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
       
  sheet.getRange(5, sCol, 1, 3).setValues([["UID", "Roll No", "Name"]])
       .setBackground("#f8fafc").setFontWeight("bold").setHorizontalAlignment("center").setFontColor("#64748b").setFontSize(9);
  
  const idRows = students.map(s => [s.id, s.roll, s.name]);
  sheet.getRange(rDataS, sCol, totalSt, 3).setValues(idRows).setBackground("#ffffff").setFontWeight("bold").setFontSize(9).setFontColor("#1e293b");

  // ── LAYER 2: HEADERS ──
  const cM = sCol + 3;                   
  const cME = cM + mainSubs.length - 1;  
  const cS = cME + 1;                    
  const cSE = cS + skillSubs.length - 1; 
  const cR = cSE + 1;                    

  sheet.getRange(1, cM, 1, bW - 3).merge().setValue(config.schoolNameBig.toUpperCase())
       .setBackground("#1e40af").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontSize(20);
       
  sheet.getRange(2, cM, 1, bW - 3).merge().setValue(exName)
       .setBackground("#d35400").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontSize(11);

  sheet.getRange(4, cM, 1, mainSubs.length).merge().setValue("MAIN SUBJECTS").setBackground(PALETTE.MAIN_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
  if(skillSubs.length > 0) {
    sheet.getRange(4, cS, 1, skillSubs.length).merge().setValue("INTERNAL/SKILL").setBackground(PALETTE.SKILL_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
  }
  sheet.getRange(4, cR, 1, 3).merge().setValue("RESULT").setBackground(PALETTE.RES_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);

  const headers = mainSubs.concat(skillSubs).concat(["TOT", "%", "RNK"]);
  sheet.getRange(5, cM, 1, headers.length).setValues([headers]).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(9).setFontColor("#0f172a");
  
  sheet.getRange(5, cM, 1, mainSubs.length).setBackground(PALETTE.MAIN_HEAD).setFontColor(PALETTE.MAIN_TEXT);
  if(skillSubs.length > 0) sheet.getRange(5, cS, 1, skillSubs.length).setBackground(PALETTE.SKILL_HEAD).setFontColor(PALETTE.SKILL_TEXT);
  sheet.getRange(5, cR, 1, 3).setBackground(PALETTE.RES_HEAD).setFontColor(PALETTE.RES_TEXT);

  // ── LAYER 3: MAX MARKS ──
  const maxMarksValues = mainSubs.map(() => 80).concat(skillSubs.map(() => 100)).concat(["", "", ""]);
  sheet.getRange(rMaxM, cM, 1, headers.length).setValues([maxMarksValues]).setFontWeight("bold").setHorizontalAlignment("center").setBackground(PALETTE.MAX_BG).setFontColor(PALETTE.MAX_TEXT).setFontSize(9);
  sheet.getRange(rMaxM, sCol, 1, 3).merge().setValue("MAX MARKS").setBackground(PALETTE.MAX_BG).setFontColor(PALETTE.MAX_TEXT).setFontWeight("bold").setHorizontalAlignment("right").setFontSize(9);

  // ── LAYER 4: SMART MATH/BIO SPLIT FORMULAS ──
  const coreCols = [];
  const optCols = [];

  // ऑटो-डिटेक्ट: कौनसे सब्जेक्ट Core हैं और कौनसे Math/Bio (Optional)
  mainSubs.forEach((sub, idx) => {
    let clean = sub.toLowerCase().trim();
    let colLetter = colToLet(cM + idx);
    if (clean.includes("math") || clean.includes("bio")) {
      optCols.push(colLetter); // Optional Array
    } else {
      coreCols.push(colLetter); // Core Array
    }
  });

  sheet.getRange(rDataS, cM, totalSt, mainSubs.length).setBackground(PALETTE.MAIN_CELL);
  if(skillSubs.length > 0) sheet.getRange(rDataS, cS, totalSt, skillSubs.length).setBackground(PALETTE.SKILL_CELL);

  const bodyFormulas = [];
  for (let i = 0; i < totalSt; i++) {
    let row = rDataS + i;
    
    let coreR = coreCols.map(c => `${c}${row}`).join(',');
    let optR = optCols.map(c => `${c}${row}`).join(',');
    let maxCoreRef = coreCols.map(c => `${c}$${rMaxM}`).join(',');
    let maxOptRef = optCols.map(c => `${c}$${rMaxM}`).join(',');

    let fTotal = "";
    let fPct = "";
    
    // अगर दोनों Math और Bio मौजूद हैं, तो MAX() लॉजिक लगेगा, वरना सिंपल SUM()
    if (optCols.length > 0) {
      let coreSum = coreCols.length > 0 ? `SUM(${coreR})` : `0`;
      let optSum = `MAX(${optR})`;
      fTotal = `=IF(COUNT(${coreR}, ${optR})=0, "", ${coreSum} + ${optSum})`;
      
      let maxCoreSum = coreCols.length > 0 ? `SUM(${maxCoreRef})` : `0`;
      let maxOptSum = `MAX(${maxOptRef})`;
      fPct = `=IFERROR(ROUND((${colToLet(cR)}${row} / (${maxCoreSum} + ${maxOptSum}))*100, 1), "")`;
    } else {
      let mainRangeFormula = `${colToLet(cM)}${row}:${colToLet(cME)}${row}`;
      fTotal = `=IF(COUNT(${mainRangeFormula})=0, "", SUM(${mainRangeFormula}))`;
      fPct = `=IFERROR(ROUND((${colToLet(cR)}${row} / SUM(${colToLet(cM)}$${rMaxM}:${colToLet(cME)}$${rMaxM}))*100, 1), "")`;
    }

    let fRank = `=IFERROR(RANK(${colToLet(cR+1)}${row}, ${colToLet(cR+1)}$${rDataS}:${colToLet(cR+1)}$${rDataEnd}), "")`;
    bodyFormulas.push([fTotal, fPct, fRank]);
  }
  sheet.getRange(rDataS, cR, totalSt, 3).setValues(bodyFormulas).setBackground(PALETTE.RES_CELL).setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);

  // ── LAYER 5: KPI STATS FOOTER ──
  const allSubs = mainSubs.concat(skillSubs).concat(["TOT"]);
  allSubs.forEach((sub, idx) => {
    let col = cM + idx;
    let colL = colToLet(col);
    let dR = `${colL}${rDataS}:${colL}${rDataEnd}`;
    let mRef = `${colL}${rMaxM}`;
    
    let statFormulas = [
      [`=COUNTA(${colToLet(sCol+2)}${rDataS}:${colToLet(sCol+2)}${rDataEnd})`],
      [`=COUNT(${dR})`],
      [`=COUNTIF(${dR}, ">="&(${mRef}*0.33))`],
      [`=IF(COUNT(${dR})=0, 0, COUNTIF(${dR}, "<"&(${mRef}*0.33)) - COUNTIF(${dR}, "AB"))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.33), ${dR}, "<"&(${mRef}*0.60))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.60), ${dR}, "<"&(${mRef}*0.75))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.75), ${dR}, "<"&(${mRef}*0.90))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.90), ${dR}, "<="&(${mRef}*0.95))`],
      [`=COUNTIF(${dR}, ">"&(${mRef}*0.95))`],
      [`=IFERROR(ROUND(AVERAGE(${dR}), 1), 0)`]
    ];
    
    let statsRange = sheet.getRange(rStatS, col, 10, 1);
    statsRange.setFormulas(statFormulas).setHorizontalAlignment("center").setFontSize(8).setFontWeight("bold");
    
    for(let fR = 0; fR < 10; fR++) {
      let bg = (fR % 2 == 0) ? "#f8fafc" : "#ffffff";
      sheet.getRange(rStatS + fR, col).setBackground(bg);
    }
    sheet.getRange(rStatS + 2, col).setFontColor("#15803d");
    sheet.getRange(rStatS + 3, col).setFontColor("#b91c1c");
    sheet.getRange(rStatS + 9, col).setBackground("#eff6ff").setFontColor("#1e40af").setFontSize(9);
  });

  let labels = [["TOTAL STUDENTS"], ["APPEARED"], ["PASS (≥33%)"], ["FAIL (<33%)"], ["33-59%"], ["60-74%"], ["75-89%"], ["90-95%"], [">95%"], ["SUBJECT AVG"]];
  for (let rOffset = 0; rOffset < 10; rOffset++) {
    sheet.getRange(rStatS + rOffset, sCol, 1, 3).merge();
  }
  sheet.getRange(rStatS, sCol, 10, 1)
       .setValues(labels)
       .setFontWeight("bold")
       .setHorizontalAlignment("right")
       .setBackground("#0f172a")
       .setFontColor("white")
       .setFontSize(8);

  for(let rIdx = 0; rIdx < 10; rIdx++){
    sheet.setRowHeight(rStatS + rIdx, 20);
  }

  // 🟢 Helper Call
  applySrSecBlockBordersAndCF(sheet, sCol, bW, rDataS, totalSt, rMaxM, cR, rStatS);
  return bW;
}

function applySrSecBlockBordersAndCF(sheet, sCol, bW, rDataS, totalSt, rMaxM, cR, rStatS) {
  const rules = sheet.getConditionalFormatRules();
  
  const blockDataRange = sheet.getRange(rDataS, sCol + 3, totalSt, bW - 6); 
  const pctCellRange = sheet.getRange(rDataS, cR + 1, totalSt, 1);          
  const identityNameRange = sheet.getRange(rDataS, sCol + 2, totalSt, 1); 
  const totColumnRange = sheet.getRange(rDataS, cR, totalSt, 1);          
  const pctColumnRange = sheet.getRange(rDataS, cR + 1, totalSt, 1);      
  
  const currentBlockMaxRowRef = colToLet(sCol + 3) + "$" + rMaxM;

  // Rule 1: Fail Overlap (< 33%)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND(ISNUMBER(${colToLet(sCol+3)}${rDataS}), ${colToLet(sCol+3)}${rDataS} < ${currentBlockMaxRowRef}*0.33)`)
    .setBackground("#f87171").setFontColor("#ffffff").setRanges([blockDataRange]).build());

  // Rule 2: Elite Topper (>= 90%)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND(ISNUMBER(${colToLet(sCol+3)}${rDataS}), ${colToLet(sCol+3)}${rDataS} >= ${currentBlockMaxRowRef}*0.90)`)
    .setBackground("#16a34a").setFontColor("#ffffff").setRanges([blockDataRange]).build());

  // Rule 3: Absent Special Token
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("AB").setBackground("#fef08a").setFontColor("#854d0e").setRanges([blockDataRange]).build());

  // Rule 4: % Column Excellence Highlight
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(90).setBackground("#16a34a").setFontColor("#ffffff").setRanges([pctCellRange]).build());

  // Rank 1, 2, 3 Standings Rules (Crash Proof Iteration)
  const rankColLetter = colToLet(cR + 2);
  const ranks = [
    { num: 1, bg: "#fcd34d" }, // Gold
    { num: 2, bg: "#e2e8f0" }, // Silver
    { num: 3, bg: "#fdba74" }  // Bronze
  ];
  
  ranks.forEach(r => {
    const formula = `=$${rankColLetter}${rDataS}=${r.num}`;
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(r.bg).setBold(true).setRanges([identityNameRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(r.bg).setBold(true).setRanges([totColumnRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(r.bg).setBold(true).setRanges([pctColumnRange]).build());
  });

  sheet.setConditionalFormatRules(rules);

  // पूरे ग्रिड पर लाइन्स लगाना और Width सेट करना
  const finalBlockMaxRow = rStatS + 9;
  sheet.getRange(1, sCol, finalBlockMaxRow, bW).setBorder(true, true, true, true, true, true, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
  
  // 🟢 Width Fix exactly like Junior/Senior
  sheet.setColumnWidths(sCol, bW, 60); 
  sheet.setColumnWidth(sCol, 130); 
  sheet.setColumnWidth(sCol + 2, 160); 
}

/**
 * ============================================================================
 * ENGINE 4: SR. SECONDARY ARTS BLOCK BUILDER (Classes 11-12)
 * Smart Formula: Standard SUM for all Core Subjects
 * ============================================================================
 */
function buildDynamicSrSecArtsBlock(sheet, sCol, exName, students, mainSubs, skillSubs, config) {
  const bW = 3 + mainSubs.length + skillSubs.length + 3; 
  
  const requiredTotalCols = sCol + bW + 2; 
  prepareSheetColumns(sheet, requiredTotalCols);

  const rDataS = 6;
  const totalSt = students.length;
  const rDataEnd = rDataS + totalSt - 1;
  const rMaxM = rDataEnd + 1;
  const rStatS = rMaxM + 2; 
  const finalBlockMaxRow = rStatS + 9;

  // 🧹 100% SAFE FIX: No breakApart(). सिर्फ गैप और बैकग्राउंड को रिसेट करेंगे
  const cleanStartCol = sCol > 1 ? (sCol - 2) : sCol;
  const cleanWidth = (sCol + bW - 1) - cleanStartCol + 1;
  
  sheet.getRange(1, cleanStartCol, finalBlockMaxRow, cleanWidth)
       .setBackground("#ffffff")
       .setBorder(false, false, false, false, false, false);

  if (sCol > 1) {
    sheet.getRange(1, sCol - 2, finalBlockMaxRow, 2).clearContent();
  }
  
  sheet.getRange(1, sCol, finalBlockMaxRow, bW).setBackground("#ffffff");

  // 🎨 PALETTE for 11-12 Arts (Professional Burgundy/Rose Theme)
  const PALETTE = {
    ID_PANE: "#831843", ID_TEXT: "#ffffff", ID_SUB: "#4c1d95",
    MAIN_CAT: "#be123c", MAIN_HEAD: "#ffe4e6", MAIN_TEXT: "#be123c", MAIN_CELL: "#fff1f2",
    SKILL_CAT: "#92400e", SKILL_HEAD: "#ffedd5", SKILL_TEXT: "#92400e", SKILL_CELL: "#fff7ed",
    RES_CAT: "#5b21b6", RES_HEAD: "#ede9fe", RES_TEXT: "#5b21b6", RES_CELL: "#f5f3ff",
    MAX_BG: "#fef3c7", MAX_TEXT: "#92400e"
  };

  // ── LAYER 1: IDENTITY ──
  sheet.getRange(1, sCol, 2, 3).merge()
       .setValue(`SR. SEC ARTS\n${exName}`)
       .setBackground(PALETTE.ID_PANE).setFontColor(PALETTE.ID_TEXT).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(11).setWrap(true);
       
  sheet.getRange(4, sCol, 1, 3).merge().setValue("STUDENT IDENTITY")
       .setBackground(PALETTE.ID_SUB).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
       
  sheet.getRange(5, sCol, 1, 3).setValues([["UID", "Roll No", "Name"]])
       .setBackground("#f8fafc").setFontWeight("bold").setHorizontalAlignment("center").setFontColor("#64748b").setFontSize(9);
  
  const idRows = students.map(s => [s.id, s.roll, s.name]);
  sheet.getRange(rDataS, sCol, totalSt, 3).setValues(idRows).setBackground("#ffffff").setFontWeight("bold").setFontSize(9).setFontColor("#1e293b");

  // ── LAYER 2: HEADERS ──
  const cM = sCol + 3;                   
  const cME = cM + mainSubs.length - 1;  
  const cS = cME + 1;                    
  const cSE = cS + skillSubs.length - 1; 
  const cR = cSE + 1;                    

  sheet.getRange(1, cM, 1, bW - 3).merge().setValue(config.schoolNameBig.toUpperCase())
       .setBackground("#9f1239").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontSize(20);
       
  sheet.getRange(2, cM, 1, bW - 3).merge().setValue(exName)
       .setBackground("#d35400").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontSize(11);

  sheet.getRange(4, cM, 1, mainSubs.length).merge().setValue("MAIN SUBJECTS").setBackground(PALETTE.MAIN_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
  if(skillSubs.length > 0) {
    sheet.getRange(4, cS, 1, skillSubs.length).merge().setValue("INTERNAL/SKILL").setBackground(PALETTE.SKILL_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
  }
  sheet.getRange(4, cR, 1, 3).merge().setValue("RESULT").setBackground(PALETTE.RES_CAT).setFontColor("white").setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);

  const headers = mainSubs.concat(skillSubs).concat(["TOT", "%", "RNK"]);
  sheet.getRange(5, cM, 1, headers.length).setValues([headers]).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(9).setFontColor("#0f172a");
  
  sheet.getRange(5, cM, 1, mainSubs.length).setBackground(PALETTE.MAIN_HEAD).setFontColor(PALETTE.MAIN_TEXT);
  if(skillSubs.length > 0) sheet.getRange(5, cS, 1, skillSubs.length).setBackground(PALETTE.SKILL_HEAD).setFontColor(PALETTE.SKILL_TEXT);
  sheet.getRange(5, cR, 1, 3).setBackground(PALETTE.RES_HEAD).setFontColor(PALETTE.RES_TEXT);

  // ── LAYER 3: MAX MARKS ──
  const maxMarksValues = mainSubs.map(() => 80).concat(skillSubs.map(() => 100)).concat(["", "", ""]);
  sheet.getRange(rMaxM, cM, 1, headers.length).setValues([maxMarksValues]).setFontWeight("bold").setHorizontalAlignment("center").setBackground(PALETTE.MAX_BG).setFontColor(PALETTE.MAX_TEXT).setFontSize(9);
  sheet.getRange(rMaxM, sCol, 1, 3).merge().setValue("MAX MARKS").setBackground(PALETTE.MAX_BG).setFontColor(PALETTE.MAX_TEXT).setFontWeight("bold").setHorizontalAlignment("right").setFontSize(9);

  // ── LAYER 4: STANDARD SUM FORMULAS (Arts) ──
  sheet.getRange(rDataS, cM, totalSt, mainSubs.length).setBackground(PALETTE.MAIN_CELL);
  if(skillSubs.length > 0) sheet.getRange(rDataS, cS, totalSt, skillSubs.length).setBackground(PALETTE.SKILL_CELL);

  const bodyFormulas = [];
  for (let i = 0; i < totalSt; i++) {
    let row = rDataS + i;
    let mainRangeFormula = `${colToLet(cM)}${row}:${colToLet(cME)}${row}`;
    
    // Arts के लिए सीधा SUM, कोई MAX() लॉजिक नहीं
    let fTotal = `=IF(COUNT(${mainRangeFormula})=0, "", SUM(${mainRangeFormula}))`;
    let fPct = `=IFERROR(ROUND((${colToLet(cR)}${row} / SUM(${colToLet(cM)}$${rMaxM}:${colToLet(cME)}$${rMaxM}))*100, 1), "")`;
    let fRank = `=IFERROR(RANK(${colToLet(cR+1)}${row}, ${colToLet(cR+1)}$${rDataS}:${colToLet(cR+1)}$${rDataEnd}), "")`;
    
    bodyFormulas.push([fTotal, fPct, fRank]);
  }
  sheet.getRange(rDataS, cR, totalSt, 3).setValues(bodyFormulas).setBackground(PALETTE.RES_CELL).setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);

  // ── LAYER 5: KPI STATS FOOTER ──
  const allSubs = mainSubs.concat(skillSubs).concat(["TOT"]);
  allSubs.forEach((sub, idx) => {
    let col = cM + idx;
    let colL = colToLet(col);
    let dR = `${colL}${rDataS}:${colL}${rDataEnd}`;
    let mRef = `${colL}${rMaxM}`;
    
    let statFormulas = [
      [`=COUNTA(${colToLet(sCol+2)}${rDataS}:${colToLet(sCol+2)}${rDataEnd})`],
      [`=COUNT(${dR})`],
      [`=COUNTIF(${dR}, ">="&(${mRef}*0.33))`],
      [`=IF(COUNT(${dR})=0, 0, COUNTIF(${dR}, "<"&(${mRef}*0.33)) - COUNTIF(${dR}, "AB"))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.33), ${dR}, "<"&(${mRef}*0.60))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.60), ${dR}, "<"&(${mRef}*0.75))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.75), ${dR}, "<"&(${mRef}*0.90))`],
      [`=COUNTIFS(${dR}, ">="&(${mRef}*0.90), ${dR}, "<="&(${mRef}*0.95))`],
      [`=COUNTIF(${dR}, ">"&(${mRef}*0.95))`],
      [`=IFERROR(ROUND(AVERAGE(${dR}), 1), 0)`]
    ];
    
    let statsRange = sheet.getRange(rStatS, col, 10, 1);
    statsRange.setFormulas(statFormulas).setHorizontalAlignment("center").setFontSize(8).setFontWeight("bold");
    
    for(let fR = 0; fR < 10; fR++) {
      let bg = (fR % 2 == 0) ? "#f8fafc" : "#ffffff";
      sheet.getRange(rStatS + fR, col).setBackground(bg);
    }
    sheet.getRange(rStatS + 2, col).setFontColor("#15803d");
    sheet.getRange(rStatS + 3, col).setFontColor("#b91c1c");
    sheet.getRange(rStatS + 9, col).setBackground("#ffe4e6").setFontColor("#9f1239").setFontSize(9);
  });

  let labels = [["TOTAL STUDENTS"], ["APPEARED"], ["PASS (≥33%)"], ["FAIL (<33%)"], ["33-59%"], ["60-74%"], ["75-89%"], ["90-95%"], [">95%"], ["SUBJECT AVG"]];
  for (let rOffset = 0; rOffset < 10; rOffset++) {
    sheet.getRange(rStatS + rOffset, sCol, 1, 3).merge();
  }
  sheet.getRange(rStatS, sCol, 10, 1)
       .setValues(labels)
       .setFontWeight("bold")
       .setHorizontalAlignment("right")
       .setBackground("#4c1d95")
       .setFontColor("white")
       .setFontSize(8);

  for(let rIdx = 0; rIdx < 10; rIdx++){
    sheet.setRowHeight(rStatS + rIdx, 20);
  }

  // 🟢 Helper Call (Uses the exact same helper from Science)
  applySrSecBlockBordersAndCF(sheet, sCol, bW, rDataS, totalSt, rMaxM, cR, rStatS);
  return bW;
}


/**
 * ============================================================================
 * HELPER: COLUMN INDEX TO LETTER CONVERTER
 * Converts a 1-based column index to its exact Excel/Sheets letter mapping
 * ============================================================================
 */
function colToLet(col) {
  var letter = "";
  while (col > 0) {
    var t = (col - 1) % 26;
    letter = String.fromCharCode(65 + t) + letter;
    col = (col - t) / 26 | 0;
  }
  return letter;
}

/**
 * ============================================================================
 * HELPER: DYNAMIC SHEET COLUMN INJECTOR
 * Checks and ensures the sheet has enough columns before appending tables
 * ============================================================================
 */
function prepareSheetColumns(sheet, needed) {
  var currentCols = sheet.getMaxColumns();
  if (currentCols < needed) {
    sheet.insertColumnsAfter(currentCols, needed - currentCols);
  }
}
/**
 * ============================================================================
 * HELPER: SAFE COLUMN RESOLVER (Defensive Guard)
 * Accepts EITHER a numeric column index OR a letter string (like "JS") and
 * always returns a valid NUMBER. Prevents "Cannot convert 'XX' to int" crashes
 * anywhere in the codebase, even if colToLet() result is passed by mistake.
 * ============================================================================
 */
function resolveColNum(value) {
  if (typeof value === "number" && !isNaN(value)) return value;
  
  if (typeof value === "string" && /^[A-Za-z]+$/.test(value)) {
    // Letter string mila (jaise "JS") -> ise number mein convert karo
    let col = 0;
    const s = value.toUpperCase();
    for (let i = 0; i < s.length; i++) {
      col = col * 26 + (s.charCodeAt(i) - 64);
    }
    return col;
  }
  
  throw new Error(`resolveColNum(): Invalid column reference received -> "${value}"`);
}

/**
 * ============================================================================
 * HELPER: SAFE GET-RANGE WRAPPER
 * Drop-in replacement for sheet.getRange(row, col, ...) that auto-corrects
 * accidental letter-string column arguments before Apps Script sees them.
 * ============================================================================
 */
function safeGetRange(sheet, row, col, numRows, numCols) {
  const safeCol = resolveColNum(col);
  if (numRows !== undefined && numCols !== undefined) {
    return sheet.getRange(row, safeCol, numRows, numCols);
  }
  return sheet.getRange(row, safeCol);
}





