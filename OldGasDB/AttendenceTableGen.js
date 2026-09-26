function getConnections() {
  var sourceID = "1aSVgvuv16Gwfe9uvME3rxaazseBdJR8TsryO5vlboqI"; 
  var destID = "1aSVgvuv16Gwfe9uvME3rxaazseBdJR8TsryO5vlboqI"; 
  return {
    source: SpreadsheetApp.openById(sourceID),
    dest: SpreadsheetApp.openById(destID)
  };
}


// Global variable ki jagah, hum data fetch karenge
// Isko remove ya comment kar do:
// var STUDENT_CONFIG = { ... formulas ... }; 

function getDynamicConfig(sourceSS) {
  var configSheet = sourceSS.getSheetByName("Master_Config");
  
  return {
    BIG_HEADER: {
      TITLE: configSheet.getRange("C4").getValue(), // Direct Value, NOT Formula
      SUB_1: configSheet.getRange("C11").getValue(),
      SUB_2: configSheet.getRange("C7").getValue(),
      SUB_3: configSheet.getRange("C9").getValue()
    },
    SMALL_HEADER: {
      TITLE: configSheet.getRange("C17").getValue(),
      SUB_1: "MONTHLY",
      SUB_2: "RECORD",
      SUB_3: "ATTENDANCE LOG"
    },
    YEAR: 2026
  };
}


/**
 * ==========================================================================
 * PROJECT: ULTIMATE ATTENDANCE SHEET EDITOR - PROFESSIONAL V2 (INDUSTRIAL)
 * FIXES: Teacher Order, Frozen Rows (5), A1:C4 Title, Colored Summary Headers
 * ==========================================================================
 */



// --- VISUAL PALETTES ---
var THEME_STUDENT = {
  HEAD_BIG_BG:   "#0c343d", HEAD_SMALL_BG: "#d35400", HEAD_TEXT: "#ffffff",
  INFO_BG_1:     "#e0f2f1", INFO_BG_2:     "#b2dfdb", INFO_BG_3: "#e0f2f1",
  MONTH_BG:      "#00695c", SUMMARY_BG:    "#2c003e",
  BODY_BG_1:     "#ffffff", BODY_BG_2:     "#f4f6f7", GAP_BG:    "#2c3e50",
  FOOT_P_BG:     "#d9ead3", FOOT_A_BG:     "#f4cccc", FOOT_L_BG: "#fff2cc", FOOT_OD_BG: "#cfe2f3", FOOT_PERC_BG: "#ecf0f1",
  TEXT_DARK:     "#2d3436", TEXT_LIGHT:    "#ffffff",
  STATUS_P: "#27ae60", STATUS_A: "#c0392b", STATUS_L: "#f39c12", STATUS_OD: "#2980b9" // Darker versions for Headers
};

var THEME_TEACHER = {
  HEAD_BIG_BG:   "#2c003e", HEAD_SMALL_BG: "#004d40", HEAD_TEXT: "#ffffff",
  INFO_BG_1:     "#f3e5f5", INFO_BG_2:     "#e1bee7", INFO_BG_3: "#f3e5f5",
  MONTH_BG:      "#6a1b9a", SUMMARY_BG:    "#00695c",
  BODY_BG_1:     "#ffffff", BODY_BG_2:     "#fafafa", GAP_BG:    "#212121",
  FOOT_P_BG:     "#d9ead3", FOOT_A_BG:     "#f4cccc", FOOT_L_BG: "#fff2cc", FOOT_OD_BG: "#cfe2f3", FOOT_PERC_BG: "#eceff1",
  TEXT_DARK:     "#2d3436", TEXT_LIGHT:    "#ffffff",
  STATUS_P: "#1e8449", STATUS_A: "#922b21", STATUS_L: "#af601a", STATUS_OD: "#1a5276" // Darker versions for Headers
};

// ==========================================================================
// 2. LAUNCHER FUNCTIONS
// ==========================================================================

function generateStudentRegister() {
  processRegister("Student_Data", null, THEME_STUDENT, "STUDENT");
}

function generateTeacherRegister() {
  processRegister("Teacher_Data", null, THEME_TEACHER, "TEACHER");
}

function processRegister(sheetName, CONFIG, THEME, TYPE) {
  var conn = getConnections();
  var sourceSS = conn.source;  // Data yaha se aayega
  var destSS = conn.dest;      // Register yaha banega
  var CONFIG = getDynamicConfig(sourceSS); // Config sheet se value uthayi

  var sheet = sourceSS.getSheetByName(sheetName);
  if (!sheet) { Browser.msgBox("Error: Sheet '" + sheetName + "' not found."); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow < 6) return;
  var data = sheet.getRange(6, 1, lastRow - 5, 7).getValues();
  
  var groups = {};

  if (TYPE === "STUDENT") {
    data.forEach(r => {
      if (r[0] == "") return;
      var key = r[5] + r[6]; 
      var tabName = key + "-" + String(CONFIG.YEAR).slice(-2);
      if (!groups[tabName]) groups[tabName] = [];
      groups[tabName].push({ id: r[0], roll: Number(r[1]), name: r[2] });
    });
  } else {
    var tabName = "Staff_Register_" + CONFIG.YEAR;
    groups[tabName] = [];
    data.forEach(r => {
      // 🛡️ TEACHER ORDER FIX: Sorting line removed to maintain data order
      if (r[0] != "") groups[tabName].push({ id: r[0], roll: r[6], name: r[1] });
    });
  }

  for (var name in groups) {
    if (TYPE === "STUDENT") groups[name].sort((a,b) => a.roll - b.roll);
    renderUltimateSheet(destSS, name, groups[name], CONFIG, THEME, TYPE);
  }
  
  Browser.msgBox(TYPE + " Register Generation Complete!");
}

function renderUltimateSheet(destSS, sheetName, dataList, CONFIG, THEME, TYPE) {
  var sheet = destSS.getSheetByName(sheetName);
  if (sheet) sheet.clear();
  else sheet = destSS.insertSheet(sheetName);

  var START_COL = 4;
  var DAYS_W = 31;
  var STATS_W = 5;
  var GAP_W = 2;
  var BLOCK_W = DAYS_W + STATS_W + GAP_W; 
  
  var headerRows = 5;
  var dataRows = dataList.length;
  var footerRows = 5;
  var totalRows = Math.max(headerRows + dataRows + footerRows + 2, 25);
  var totalCols = START_COL + (12 * BLOCK_W); 

  var maxRows = sheet.getMaxRows();
  var maxCols = sheet.getMaxColumns();
  if (maxRows > totalRows) sheet.deleteRows(totalRows + 1, maxRows - totalRows);
  else if (maxRows < totalRows) sheet.insertRowsAfter(maxRows, totalRows - maxRows);
  if (maxCols > totalCols) sheet.deleteColumns(totalCols + 1, maxCols - totalCols);
  else if (maxCols < totalCols) sheet.insertColumnsAfter(maxCols, totalCols - maxCols);

  var fullRange = sheet.getRange(1, 1, totalRows, totalCols);
  fullRange.setFontFamily("Calibri").setVerticalAlignment("middle").setFontSize(10);

  // --- 1. LEFT METADATA & REGISTER TITLE ---
  sheet.setFrozenRows(5); // ✅ FIX: Row 6 is now free to scroll
  sheet.setFrozenColumns(3);

  // 🎨 ATTRACTIVE REGISTER TITLE (A1:C4)
  var regTitle = (TYPE === "STUDENT" ? "STUDENT ATTENDANCE" : "STAFF ATTENDANCE");
  sheet.getRange("A1:C4").merge()
       .setValue(regTitle + "\nSESSION: " + CONFIG.YEAR)
       .setBackground(THEME.SUMMARY_BG).setFontColor("white").setFontWeight("bold").setFontSize(11).setHorizontalAlignment("center").setWrap(true);

  var metaHeaders = TYPE === "STUDENT" ? ["ID", "ROLL", "STUDENT NAME"] : ["ID", "ROLE", "STAFF NAME"];
  sheet.getRange("A5:C5").setValues([metaHeaders])
       .setBackground(THEME.HEAD_BIG_BG).setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center")
       .setBorder(true, true, true, true, true, true, "#555555", SpreadsheetApp.BorderStyle.SOLID);

  if (dataList.length > 0) {
    var matrix = dataList.map(x => [x.id, x.roll, x.name]);
    sheet.getRange(6, 1, dataRows, 3).setValues(matrix)
         .setBorder(true, true, true, true, true, true, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);
  }

  var footerStartRow = 6 + dataRows;
  var labels = [["TOTAL PRESENT"], ["TOTAL ABSENT"], ["TOTAL LEAVE"], ["TOTAL ON-DUTY"], ["DAILY %"]];
  sheet.getRange(footerStartRow, 3, 5, 1).setValues(labels)
       .setFontWeight("bold").setHorizontalAlignment("right").setFontSize(9).setBackground(THEME.INFO_BG_1);

  sheet.setRowHeight(1, 60); 
  sheet.setRowHeight(2, 25); 
  sheet.setRowHeight(3, 10); 
  sheet.setRowHeight(4, 30); 
  sheet.setRowHeight(5, 25); 
  sheet.setRowHeights(6, dataRows, 22);

  var months = ["JANUARY", "FEBRUARY", "MARCH","APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  var curCol = START_COL;

  for (var m = 0; m < 12; m++) {
    var daysInMonth = new Date(CONFIG.YEAR, m + 1, 0).getDate();

    sheet.getRange(1, curCol, 1, DAYS_W).merge().setValue(CONFIG.BIG_HEADER.TITLE)
         .setBackground(THEME.HEAD_BIG_BG).setFontColor(THEME.HEAD_TEXT).setFontSize(16).setFontWeight("bold").setHorizontalAlignment("center");

    sheet.getRange(1, curCol + DAYS_W, 1, STATS_W).merge().setValue(CONFIG.SMALL_HEADER.TITLE)
         .setBackground(THEME.HEAD_SMALL_BG).setFontColor(THEME.HEAD_TEXT).setFontSize(10).setFontWeight("bold").setHorizontalAlignment("center");

    sheet.getRange(2, curCol, 1, 10).merge().setValue(CONFIG.BIG_HEADER.SUB_1).setBackground(THEME.INFO_BG_1).setFontSize(8);
    sheet.getRange(2, curCol+10, 1, 11).merge().setValue(CONFIG.BIG_HEADER.SUB_2).setBackground(THEME.INFO_BG_2).setFontWeight("bold").setHorizontalAlignment("center");
    sheet.getRange(2, curCol+21, 1, 10).merge().setValue(CONFIG.BIG_HEADER.SUB_3).setBackground(THEME.INFO_BG_3).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(2, curCol + DAYS_W, 1, STATS_W).merge().setValue(CONFIG.SMALL_HEADER.SUB_1 + " | " + CONFIG.SMALL_HEADER.SUB_2).setBackground(THEME.INFO_BG_2).setFontSize(8).setHorizontalAlignment("center");

    sheet.getRange(3, curCol, 1, BLOCK_W - GAP_W).setBackground("#ffffff");

    sheet.getRange(4, curCol, 1, DAYS_W).merge().setValue(months[m]).setBackground(THEME.MONTH_BG).setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
    sheet.getRange(4, curCol + DAYS_W, 1, STATS_W).merge().setValue(months[m] + " SUMMARY").setBackground(THEME.SUMMARY_BG).setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");

    // ROW 5: Colored Stats Headers
    var days = []; for(var d=1; d<=31; d++) days.push(d);
    sheet.getRange(5, curCol, 1, DAYS_W).setValues([days]).setBackground(THEME.INFO_BG_1).setFontWeight("bold").setHorizontalAlignment("center");
    
    // Stats Headers Individual Colors
    var statHeaderRange = sheet.getRange(5, curCol + DAYS_W, 1, STATS_W);
    statHeaderRange.setValues([["P", "A", "L", "OD", "%"]]).setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
    sheet.getRange(5, curCol + DAYS_W).setBackground(THEME.STATUS_P);
    sheet.getRange(5, curCol + DAYS_W + 1).setBackground(THEME.STATUS_A);
    sheet.getRange(5, curCol + DAYS_W + 2).setBackground(THEME.STATUS_L);
    sheet.getRange(5, curCol + DAYS_W + 3).setBackground(THEME.STATUS_OD);
    sheet.getRange(5, curCol + DAYS_W + 4).setBackground("#444444"); // Dark Grey for %

    if (dataRows > 0) {
      // Body formulas and Zebra Background
      var dateBodyRange = sheet.getRange(6, curCol, dataRows, DAYS_W);
      for (var r = 0; r < dataRows; r++) {
         sheet.getRange(6 + r, curCol, 1, DAYS_W).setBackground((r % 2 === 0) ? THEME.BODY_BG_1 : THEME.BODY_BG_2);
      }

      var statsFormulas = [];
      for (var r = 0; r < dataRows; r++) {
         statsFormulas.push(['=COUNTIF(RC[-31]:RC[-1], "P")', '=COUNTIF(RC[-32]:RC[-2], "A")', '=COUNTIF(RC[-33]:RC[-3], "L")', '=COUNTIF(RC[-34]:RC[-4], "OD")', '=IFERROR((RC[-4]+RC[-1]) / (RC[-4]+RC[-3]+RC[-2]+RC[-1]), 0)']);
      }
      sheet.getRange(6, curCol + DAYS_W, dataRows, 5).setFormulas(statsFormulas).setNumberFormat("0").setFontWeight("bold").setHorizontalAlignment("center");
      
      // Column Coloring based on theme
      sheet.getRange(6, curCol + DAYS_W, dataRows, 1).setBackground("#eafaf1");
      sheet.getRange(6, curCol + DAYS_W + 1,dataRows).setBackground("#fdedec");
      sheet.getRange(6, curCol + DAYS_W + 2,dataRows).setBackground("#fef9e7");
      sheet.getRange(6, curCol + DAYS_W + 3,dataRows).setBackground("#ebf5fb");
      sheet.getRange(6, curCol + DAYS_W + 4,dataRows).setNumberFormat("0%").setBackground("#f4f6f7");
    }

    // FOOTER STATS
    sheet.getRange(footerStartRow, curCol, 1, DAYS_W).setFormulaR1C1('=COUNTIF(R6C:R[-1]C, "P")').setBackground(THEME.FOOT_P_BG).setFontWeight("bold");
    sheet.getRange(footerStartRow + 1, curCol, 1, DAYS_W).setFormulaR1C1('=COUNTIF(R6C:R[-2]C, "A")').setBackground(THEME.FOOT_A_BG).setFontWeight("bold");
    sheet.getRange(footerStartRow + 2, curCol, 1, DAYS_W).setFormulaR1C1('=COUNTIF(R6C:R[-3]C, "L")').setBackground(THEME.FOOT_L_BG).setFontWeight("bold");
    sheet.getRange(footerStartRow + 3, curCol, 1, DAYS_W).setFormulaR1C1('=COUNTIF(R6C:R[-4]C, "OD")').setBackground(THEME.FOOT_OD_BG).setFontWeight("bold");
    sheet.getRange(footerStartRow + 4, curCol, 1, DAYS_W).setFormulaR1C1('=IFERROR(R[-4]C / (R[-4]C + R[-3]C + R[-2]C + R[-1]C), 0)').setNumberFormat("0%").setBackground(THEME.FOOT_PERC_BG).setFontWeight("bold");

    // INTERSECTION TOTALS
    sheet.getRange(footerStartRow, curCol + DAYS_W).setFormula('=SUM(R6C:R[-1]C)').setBackground("#d4efdf").setFontColor("#1e8449");
    sheet.getRange(footerStartRow+1, curCol + DAYS_W + 1).setFormula('=SUM(R6C:R[-1]C)').setBackground("#f9ebea").setFontColor("#922b21");
    sheet.getRange(footerStartRow+2, curCol + DAYS_W + 2).setFormula('=SUM(R6C:R[-1]C)').setBackground("#fcf3cf").setFontColor("#af601a");
    sheet.getRange(footerStartRow+3, curCol + DAYS_W + 3).setFormula('=SUM(R6C:R[-1]C)').setBackground("#d6eaf8").setFontColor("#1a5276");
    sheet.getRange(footerStartRow+4, curCol + DAYS_W + 4).setFormula('=AVERAGE(R6C:R[-1]C)').setNumberFormat("0.0%").setBackground("#bdc3c7");

    if (daysInMonth < 31) {
      sheet.getRange(5, curCol + daysInMonth, totalRows - 4, 31 - daysInMonth).setBackground("#212121").clearContent();
    }
    if (GAP_W > 0) {
      sheet.getRange(1, curCol + 36, totalRows, GAP_W).setBackground(THEME.GAP_BG);
    }
    curCol += BLOCK_W;
  }

  // Conditional Formatting for Body
 // ======================================================
  // CONDITIONAL FORMATTING FOR BODY (P, A, L, OD)
  // ======================================================
  var dataRange = sheet.getRange(6, START_COL, dataRows, totalCols - START_COL);
  
  var rules = [
    // P - Present (Light Green BG, Dark Green Text)
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("P")
      .setBackground("#d9ead3")
      .setFontColor("#1e8449")
      .setRanges([dataRange])
      .build(),
      
    // A - Absent (Light Red BG, Dark Red Text)
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("A")
      .setBackground("#f4cccc")
      .setFontColor("#922b21")
      .setRanges([dataRange])
      .build(),
      
    // L - Leave (Light Orange BG, Dark Orange Text)
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("L")
      .setBackground("#fff2cc")
      .setFontColor("#af601a")
      .setRanges([dataRange])
      .build(),
      
    // OD - On Duty (Light Blue BG, Dark Blue Text)
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("OD")
      .setBackground("#cfe2f3")
      .setFontColor("#1a5276")
      .setRanges([dataRange])
      .build()
  ];
  
  sheet.setConditionalFormatRules(rules);

  // Column widths set karna (Symmetry ke liye)
  sheet.setColumnWidths(START_COL, totalCols - START_COL + 1, 30);
  
  // Border Fix (Error Avoid karne ke liye simple logic)
  dataRange.setBorder(true, true, true, true, true, true, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);
 
}
