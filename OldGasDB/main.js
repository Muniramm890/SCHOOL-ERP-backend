// ===========================================
// 1. GLOBAL CONFIGURATION (MULTI-DATABASE)
// ===========================================
 //MASTER CONFIG
var SHEET_0_ID = "1wMjmKM-YMn5c2KN8btCTTcL-sBzwvLCgSBdj6Oe2hqc"; 

// --- DATABASE 1: New Teacher/Attendance Sheet ---

var SHEET_1_ID = "1aSVgvuv16Gwfe9uvME3rxaazseBdJR8TsryO5vlboqI"; 

// --- DATABASE 2: Old Admin/Result Sheet ---
// (Purani 'Commutative Knowledge' sheet ki ID yahan dalein)

var SHEET_2_ID = "1rObWxrm-MUphNvZhHiD2BW66EHNrRogwUyUhYAKLIns"; 


// RESULT SHEETS  
var SHEET_3_ID = "1gxhRqL99P31AF8niV6vW6S-wUq5r2PmF7J6xyHf8GOY";


// --- DATABASE 4: Finance & Fee Database ---
var SHEET_4_ID = "1N4d0NAIhhID1yErTmwWR9tuv3iDAaZbq4NusUGnMElQ"; 

//TIME TABLE & ARRENGEMENTS 
var SHEET_5_ID = "1i27sXubfGbil4d4JP3y68IXchmwvwTFUi9Z7QtDuK5A"; 

// COMMUNICATION DATA 
var SHEET_6_ID = "151KF9vg27aTdPzsd0hfiZP8LPnE8ozNuQW0Wjz7M3U4"; 


// --- DATABASE 7: Library Management System ---
var SHEET_7_ID = "1Mqen82FZ837-7tjcj1vJgpJgMGKQa1E6R8P24wBB448"; 

// Add this near the top with your other SHEET_ID variables
var SHEET_8_ID = "1C1QZehVb-2pnM6S5K34Opy0NILXEoARfSUtgTk7E-1s"; // Create a new blank sheet and paste ID here

//https://docs.google.com/spreadsheets/d/1C1QZehVb-2pnM6S5K34Opy0NILXEoARfSUtgTk7E-1s/edit?usp=sharing
// --- FUTURE EXPANSION (Example) ---//
//1g2SJ7zZUsdkJ7Z9lWWc7cfEr9YY-5Wad5tMs0yYB5Ds


// ===========================================
// 2. CONNECTION HELPER FUNCTIONS
// ===========================================
function getDB0() {
  // Returns: New Sheet (Attendance, Staff Data)
  return SpreadsheetApp.openById(SHEET_0_ID);
}

function getDB1() {
  // Returns: New Sheet (Attendance, Staff Data)
  return SpreadsheetApp.openById(SHEET_1_ID);
}

function getDB2() {
  // Returns: Old Sheet (Students, Results, Notices, Admin Login)
  return SpreadsheetApp.openById(SHEET_2_ID);
}


function getDB3() {
  // Returns: Old Sheet (Students, Results, Notices, Admin Login)
  return SpreadsheetApp.openById(SHEET_3_ID);
}

function getDB4() {
  try { return SpreadsheetApp.openById(SHEET_4_ID); }
  catch(e) { throw new Error("Finance DB (DB4) Access Denied."); }
}


function getDB5() {
  try { return SpreadsheetApp.openById(SHEET_5_ID); }
  catch(e) { throw new Error("TIME TABLE DB (DB5) Access Denied."); }
}

function getDB6() {
  try { return SpreadsheetApp.openById(SHEET_6_ID); }
  catch(e) { throw new Error("Communication DB (DB6) Access Denied."); }
}



function getDB7() {
  try { return SpreadsheetApp.openById(SHEET_7_ID); }
  catch(e) { throw new Error("Library DB (DB7) Access Denied."); }
}

function getDB8() {
  try { return SpreadsheetApp.openById(SHEET_8_ID); }
  catch(e) { throw new Error("Daily Log DB (DB8) Access Denied."); }
}


/**
 * MASTER CONFIG: Centralized data fetcher
 */
/**
 * MASTER CONFIG: Centralized data fetcher
 * Updated with Dynamic Academic Map (Classes, Sections, Subjects)
 */
function getMasterConfig() {
  const ss = getDB0();
  const sh = ss.getSheetByName("Master_Config");
  
  if (!sh) return null;

  const fixUrl = (id) => {
    let rawId = String(id || "").trim();
    if (!rawId || rawId === "N/A") return "";
    if (rawId.startsWith("http") || 
        rawId.startsWith("data:image")) {
      return rawId;
    }
    return "https://drive.google.com/uc?id=" + rawId;
  };

  // === CLASS & SUBJECT MATRIX EXTRACTION ===
  const academicConfig = {};

  try {
  
    const startRow = 5;
    const startCol = 17; // Column Q
    const numRows = 18;  // 5 से 22 तक कुल 18 रो होती हैं (22 - 5 + 1)
    const numCols = 26;  // Column Q से आगे की विड्थ

    const academicRaw = sh.getRange(startRow, startCol, numRows, numCols).getValues();

    academicRaw.forEach(function(row) {
      var rawClass = row[0];
      if (rawClass === "" || rawClass === null || rawClass === undefined) return;

      var className = String(rawClass).trim();
      if (className === "") return;
      
      // 🛡️ सेफ्टी गेटकीपर: अगर गलती से एग्जाम्स का नाम इस रेंज में आ भी जाए तो उसे फिल्टर करें
      if (className.includes("TEST") || className.includes("EXAM") || className.includes("HALF")) return;

      var classKey = "";
      var firstNum = parseInt(className);

      if (!isNaN(firstNum)) {
        var textPart = className
          .replace(String(firstNum), "")
          .replace(/[\s\-]+/g, "")
          .trim()
          .toUpperCase();

        classKey = textPart === "" 
          ? String(firstNum)
          : String(firstNum) + "-" + textPart;
      } else {
        classKey = className
          .toUpperCase()
          .replace(/[\s]+/g, "-");
      }

      if (classKey === "") return;

      var rawSections = String(row[1] || "").trim();
      var sections = rawSections === ""
        ? ["A"]
        : rawSections
            .split(",")
            .map(function(s) { return s.trim().toUpperCase(); })
            .filter(function(s) { return s !== ""; });

      var subjects = row
        .slice(2)
        .map(function(sub) { return String(sub || "").trim(); })
        .filter(function(sub) {
          return sub !== "" && sub !== "N/A" && sub !== "0" && sub !== "FALSE";
        });

      academicConfig[classKey] = {
        sections: sections,
        subjects: subjects.length > 0 ? subjects : ["General"]
      };
    });

  } catch(e) {
    Logger.log("❌ Academic Mapping Range Error: " + e.toString());
  }

  return {
    schoolName: sh.getRange("N2").getValue()
      .toString().trim().substring(0, 60),
    schoolNameBig: sh.getRange("C4").getValue()
      .toString().trim().substring(0, 90),
    currentSession: sh.getRange("C19").getValue()
      .toString().trim(),
    sessionSuffix: sh.getRange("F19").getValue()
      .toString().trim(),
    contact: sh.getRange("C9").getValue(),
    affiliation: sh.getRange("C11").getValue(),
    address: sh.getRange("C6").getValue() +
             " " +
             sh.getRange("C7").getValue(),
    senderEmail: sh.getRange("C23").getValue()
      .toString().trim(),
    logo: fixUrl(sh.getRange("O6").getValue()),
    logoId: sh.getRange("O6").getValue(),
    watermark: fixUrl(sh.getRange("O5").getValue()),
    watermarkId: sh.getRange("O5").getValue(),
    folderProfiles: sh.getRange("O8").getValue()
      .toString().trim(),
    folderReceipts: sh.getRange("O10").getValue()
      .toString().trim(),
    folderSalary: sh.getRange("O12").getValue()
      .toString().trim(),
    folderSyllabus: sh.getRange("O14").getValue()
      .toString().trim(),
    token: sh.getRange("L10").getValue()
      .toString().trim(),
    phoneId: sh.getRange("L11").getValue()
      .toString().trim(),
      rzpKeyId: sh.getRange("O16").getValue().toString().trim(),     
    rzpSecret: sh.getRange("O18").getValue().toString().trim(),
    academicMap: academicConfig
  };
}


/**====================================================================================================
 * ====================================================================================================
 * SHEETS FUNCTIONS START FROM HERE --------------------------------------------------------
 * SHEET 1 MASTER SHEET CUM ATTENDANCE -----------------------------------------------------------
 * ======================================================================================================
 */

  // ===========================================
  // MASTER ROUTER (ONLY DO POST)
   // ===========================================
function doPost(e) {
   var lock = LockService.getScriptLock();
  lock.tryLock(10000); // 10 Sec Lock for safety

  var output = { success: false, message: "Unknown Error" };
  
  try {
    var params = {};
    var action = "";

    // 🟢 1. RAZORPAY WEBHOOK ROUTER (NEW ADDITION)
    // Razorpay Webhook hamesha "application/json" bhejta hai
    if (e.postData && e.postData.type === "application/json") {
      var jsonPayload = JSON.parse(e.postData.contents);
      
      // Check karo kya ye Razorpay ka event hai?
      if (jsonPayload.event && jsonPayload.event.startsWith("payment.")) {
        return handleRazorpayWebhook(jsonPayload, e); // 🟢 FIXED: 'e' ko pass karna zaroori hai signature ke liye
      }
      
      // Agar ye JSON kisi aur kaam ka hai (e.g., naya App action)
      params = jsonPayload;
      action = params.action;
    } 
    
    // 2. PURANA LOGIC (Fallback for Old App/WhatsApp)
    if (!action && e.parameter && e.parameter.action) {
      params = e.parameter;
      action = e.parameter.action;
    }

    // Common Variable for Old Actions (DO NOT DISTURB)
    var ss = getDB2(); 

      
        // ======================================================
         // 1. UNIFIED LOGIN (Checking All 3 Sheets with Full Data)
       // ======================================================
    if (action === 'login') {
      var email = String(params.email).trim().toLowerCase();
      var pass = String(params.password).trim();
      var loginSuccess = false;
      var loginData = null;

      // ---------------------------------------------------
      // LEVEL 1: CHECK OLD ADMIN SHEET (DB2 - Users)
      // ---------------------------------------------------
      try {
        var uSheet = ss.getSheetByName("Users");
        if(uSheet) {
          var uData = uSheet.getDataRange().getValues();
          // Loop starts from 1 (Skip Header)
          for (var i = 1; i < uData.length; i++) {
            // Col 4 (Index 4) = Email, Col 5 (Index 5) = Password
            if (String(uData[i][4]).trim().toLowerCase() == email && String(uData[i][5]).trim() == pass) {
              
              var uid = String(uData[i][0]).toUpperCase();
              var role = uid.includes("ADMIN") ? "ADMIN" : "STUDENT"; // Old logic

              // FULL DATA (Skip Col 5 Password)
              loginData = {
                 uid: uData[i][0], 
                 name: uData[i][1], 
                 father: uData[i][2], 
                 mobile: uData[i][3], 
                 email: uData[i][4], 
                 // Pass skipped
                 pin: uData[i][6], 
                 photo: uData[i][7], 
                 state: uData[i][8], 
                 address: uData[i][9], 
                 regDate: formatDate(uData[i][10]),
                 
                 role: role, 
                 designation: role === 'ADMIN' ? 'Administrator' : 'Student',
                 source: 'OLD_DB'
              };
              loginSuccess = true;
              break;
            }
          }
        }
      } catch(e) { Logger.log("DB2 Login Error: " + e); }

      // ---------------------------------------------------
      // LEVEL 2: CHECK NEW TEACHER SHEET (DB1 - Teacher_Data)
      // ---------------------------------------------------
      if (!loginSuccess) {
        try {
          var tSheet = getDB1().getSheetByName("Teacher_Data");
          if(tSheet) {
            // Row 6 se data start
            var tData = tSheet.getRange(6, 1, tSheet.getLastRow()-5, tSheet.getLastColumn()).getValues();
            
            for (var j = 0; j < tData.length; j++) {
              // Col 12 (Index 12) = Email, Col 14 (Index 14) = Password
              if (String(tData[j][12]).trim().toLowerCase() == email && String(tData[j][14]).trim() == pass) {
                
                var desig = String(tData[j][6]).trim();
                var role = (desig.toUpperCase().includes("ADMIN") || desig.toUpperCase().includes("PRINCIPAL")) ? "ADMIN" : "TEACHER";

                // FULL DATA (Skip Col 14 Password)
                loginData = {
                  uid: tData[j][0], 
                  name: tData[j][1], 
                  dob: formatDate(tData[j][2]),
                  gender: tData[j][3],
                  father: tData[j][4],
                  mother: tData[j][5],
                  designation: desig,
                  subject: tData[j][7],
                  qualification: tData[j][8],
                  joinDate: formatDate(tData[j][9]),
                  salary: tData[j][10],
                  mobile: tData[j][11],
                  email: tData[j][12], 
                  address: tData[j][13],
                  // Pass skipped
                  photo: tData[j][15],
                  
                  role: role,
                  source: 'NEW_TEACHER'
                };
                loginSuccess = true;
                break;
              }
            }
          }
        } catch(e) { Logger.log("DB1 Teacher Login Error: " + e); }
      }

      // ---------------------------------------------------
      // LEVEL 3: CHECK NEW STUDENT SHEET (DB1 - Student_Data)
      // ---------------------------------------------------
      // Ye missing tha pehle
      if (!loginSuccess) {
        try {
          var sSheet = getDB1().getSheetByName("Student_Data");
          if(sSheet) {
            // Row 6 se data start
            var sData = sSheet.getRange(6, 1, sSheet.getLastRow()-5, sSheet.getLastColumn()).getValues();
            
            for (var k = 0; k < sData.length; k++) {
              // Col L (Index 11) = Email, Col N (Index 13) = Password
              var sheetEmail = String(sData[k][11]).trim().toLowerCase();
              var sheetPass = String(sData[k][13]).trim();

              if (sheetEmail == email && sheetPass == pass) {
                
                // FULL DATA (Skip Col 13 Password)
                loginData = {
                  uid: sData[k][0], 
                  roll: sData[k][1],
                  name: sData[k][2], 
                  dob: formatDate(sData[k][3]),
                  gender: sData[k][4],
                  classVal: sData[k][5], 
                  section: sData[k][6],
                  admDate: formatDate(sData[k][7]),
                  father: sData[k][8],
                  mother: sData[k][9],
                  mobile: sData[k][10],
                  email: sData[k][11], 
                  address: sData[k][12],
                  // Pass skipped
                  photo: sData[k][14],

                  role: 'STUDENT', 
                  designation: 'Student',
                  source: 'NEW_STUDENT'
                };
                loginSuccess = true;
                break;
              }
            }
          }
        } catch(e) { Logger.log("DB1 Student Login Error: " + e); }
      }

      // ====================================================
      // 🟢 FINAL RESPONSE: INJECTING PUBLIC CONFIG
      // ====================================================
      if (loginSuccess) {
        var master = getMasterConfig();
        var publicConfig = null;

        // SANITIZE: Filter out WhatsApp tokens, Folder IDs, etc.
        if (master) {
          publicConfig = {
            schoolName: master.schoolName,
            schoolNameBig: master.schoolNameBig,
            currentSession: master.currentSession,
            sessionSuffix: master.sessionSuffix,
            contact: master.contact,
            affiliation: master.affiliation,
            address: master.address,
            logo: master.logo,
            logoId: master.logoId,
            watermark: master.watermark,
            watermarkId: master.watermarkId,
            academicMap: master.academicMap // The dynamic class/subject matrix
          };
        }

        // Return combined payload
        return sendJSON(true, "Login Successful", { 
            user: loginData, 
            config: publicConfig 
        });
      } else {
        return sendJSON(false, "Invalid Email or Password");
      }
    }

    // ======================================================
    // 👑 NEW ACTIONS: DYNAMIC EXAM CONTROLLER (DB0 HUB)
    // ======================================================
else if (action === 'getExamControlLedger') {
  const res = getExamControlLedger();
  return sendJSON(res.status, res.message, res.data);
}
else if (action === 'updateExamControlCell') {
  const res = updateExamControlCell(params.examName, params.field, params.value);
  return sendJSON(res.status, res.message);
}
else if (action === 'initializeNewExamTerm') {
  // 🟢 INITIAL PHASE: Saves data to DB0, updates dropdowns instantly
  const res = initializeNewExamTerm(params);
  return sendJSON(res.status, res.message);
}
else if (action === "getRecentActivityLog") {
    // getRecentActivityLog फंक्शन आपका पहले से बना हुआ है, बस उसे यहाँ कॉल करें
    var limit = params.limit || 25;
    var result = getRecentActivityLog(limit); 
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  else if (action === 'getCommandCenterStats') {
  var res = getCommandCenterStats();
  return sendJSON(res.status, res.message, res.data);
  }

    
    
    // ======================================================
    // 2. NEW APP ACTIONS (SHEET 1 ) MASTER AND ATTENDANCE 
    // ======================================================
    else if (action === 'getClassList') {
      output = { success: true, data: fetchClassList() };
      return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
    }
    else if (action === 'getTeachers') {
      output = { success: true, data: fetchTeachers() };
      return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
    }
    else if (action === 'getStudentProfile') {
      output = { success: true, data: fetchStudentProfile(params.id) };
      return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
    }

    else if (action === 'getFullStudentBatch') {
      const res = getFullStudentBatch(params.classVal, params.sectionVal);
      return sendJSON(res.status, res.status ? "Batch Fetched" : res.message, res.data);
    }
      
    else if (action == "saveStudentAtt") {
      try {
        // 1. JSON Parse (Fix for 'map is not a function')
        var rawData = params.payload;
        var attendanceData = JSON.parse(rawData); 

        // 2. Correct Sheet Name
        var sheetName = "Attendance_Logs";
        var sheet = getDB1().getSheetByName(sheetName);
        
        // Agar Sheet nahi hai to create karein
        if (!sheet) {
          sheet = getDB1().insertSheet(sheetName);
          // Headers
          sheet.appendRow(["Date", "UID", "Roll", "Name", "Class", "Section", "Status", "Marked By", "Timestamp"]);
        }

        // 3. Prepare Rows
        var rows = attendanceData.map(function(r) {
          return [
            r.date, 
            r.id, 
            r.roll, 
            r.name, 
            r.class, 
            r.section, 
            r.status, 
            r.markedBy, 
            new Date() // Timestamp
          ];
        });

        // 4. Bulk Write
        if (rows.length > 0) {
          sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        }

        return sendJSON(true, "Student Attendance Saved!");

      } catch (e) {
        return sendJSON(false, "Server Error: " + e.message);
      }
    }
   
    else if (action === 'getHomeDashboardData') {
      const res = getHomeDashboardData();
      return sendJSON(res.status, "Dashboard Intelligence Synced", res.data);
    }
  
    else if (action == "saveTeacherAtt") {
      try {
        // 1. JSON Parse
        var rawData = params.payload;
        var attendanceData = JSON.parse(rawData); 

        // 2. Correct Sheet Name
        var sheetName = "Teacher_Attendance_Logs";
        var sheet = getDB1().getSheetByName(sheetName);
        
        // Create if missing
        if (!sheet) {
          sheet = getDB1().insertSheet(sheetName);
          sheet.appendRow(["Date", "UID", "Name", "Designation", "Status", "Timestamp"]);
        }

        // 3. Prepare Rows
        var rows = attendanceData.map(function(r) {
          return [
            r.date, 
            r.id, 
            r.name, 
            r.designation, 
            r.status, 
            new Date()
          ];
        });

        // 4. Bulk Write
        if (rows.length > 0) {
          sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        }

        return sendJSON(true, "Staff Attendance Saved!");

      } catch (e) {
        return sendJSON(false, "Server Error: " + e.message);
      }
    }
    else if (action === 'addNewStudent') {
      output = addNewStudent(params.data);
      return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
    }
    // ======================================================
    // 🟢 NEW: STUDENT DIRECTORY — PROMOTION & MANAGEMENT ACTIONS
    // ======================================================
    else if (action === 'getPendingRegistrations') {
      const res = getPendingRegistrations();
      return sendJSON(res.status, res.message, res.data);
    }
    else if (action === 'promoteToOfficial') {
      const res = promoteToOfficial(params);
      return sendJSON(res.status, res.message, res.data);
    }
    else if (action === 'deleteOfficialStudent') {
      const res = deleteOfficialStudent(params.uid);
      return sendJSON(res.status, res.message);
    }
    else if (action === 'deletePendingRegistration') {
      const res = deletePendingRegistration(params.uid);
      return sendJSON(res.status, res.message);
    }
    else if (action === 'resetStudentPassword') {
      const res = resetStudentPassword(params.uid, params.source, params.newPassword);
      return sendJSON(res.status, res.message);
    }
    else if (action === 'addNewTeacher') {
      output = addNewTeacher(params.data);
      return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
    }
   else if (action === 'getAttendanceData') {
    try {
    const res = masterAttendanceLogic(params); 
    return sendJSON(true, "Data Fetched successfully", res);
     } catch (e) {
    return sendJSON(false, "Master Error: " + e.message);
      }
   }
   // 🟢 TIER 1: Daily Log Fetcher (All Classes Summary)
    else if (action === 'getDailyAttendanceSummary') {
      const res = getDailyAttendanceSummary(params.date);
      return sendJSON(res.status, res.message, res.data);
    }
    
    
     // 🟢 TIER 3: Individual Student Deep Dossier (SECURED FOR STUDENT PORTAL)
    else if (action === 'getStudentMonthlyHistory') {
      try {
        // 🔒 ZERO-TRUST SECURITY: Student sirf apna data dekh sakega
        if (String(params.verifiedRole).toUpperCase() === 'STUDENT') {
          var profile = fetchStudentProfile(params.uid);
          if (!profile || String(profile.email).trim().toLowerCase() !== String(params.verifiedEmail).trim().toLowerCase()) {
            return sendJSON(false, "Security Breach: Unauthorized Data Access.");
          }
        }
        
        var res = getStudentMonthlyHistory(params.uid, params.classVal, params.section);
        return sendJSON(res.status, res.message, res.data);
      } catch (e) {
        return sendJSON(false, "Attendance Fetch Error: " + e.message);
      }
    }
     
     
    // ======================================================
    //  CONFLICT HANDLING: 'getStudents'
    // ======================================================
    else if (action === 'getStudents') {
      // Agar Class aayi hai -> Attendance App (New)
      if (params.classStr) {
        output = { success: true, data: fetchStudents(params.classStr) };
        return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
      } 
      // Agar Class nahi hai -> Admin App (Old)
      else {
        var uSheet = ss.getSheetByName("Users");
        var uData = uSheet.getDataRange().getValues();
        var users = [];
        for (var i = 1; i < uData.length; i++) {
          users.push({
            uid: uData[i][0], name: uData[i][1], father: uData[i][2],
            mobile: uData[i][3], email: uData[i][4], photo: uData[i][7], address: uData[i][9]
          });
        }
        return sendJSON(true, "Students Fetched", users);
      }
    }
    // ======================================================
    // 🟢 NEW ACTION: Dedicated for Student Directory
    // ======================================================
     else if (action === 'getDirectoryData') {
      const res = fetchStandardizedDirectory(params);
      return sendJSON(res.status, res.message, res.data);
     } 

     else if (action === 'getAllOfficialStudents') {
      const res = getAllOfficialStudents();
      return sendJSON(res.status, res.message, res.data);
    }
    // ======================================================
    // 3. OLD APP ACTIONS ( SHEET 2 ) TEST DATA AND RESULT 
    // ======================================================
    
    
        // --- Register ---
    else if (action == "register") {
      var sheet = ss.getSheetByName("Users"); // Yeh DB2 hai
      if (!sheet) return sendJSON(false, "Users sheet not found");
      var data = sheet.getDataRange().getValues();
      var inputMobile = String(params.mobile || '').trim();
      var inputEmail = String(params.email || '').trim().toLowerCase();

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][3]).trim() == inputMobile || String(data[i][4]).trim().toLowerCase() == inputEmail) {
          return sendJSON(false, "Email or Mobile already exists!");
        }
      }
      
      var newID = "U-" + Math.floor(100000 + Math.random() * 900000);
      var pin = params.pin || Math.floor(1000 + Math.random() * 9000); // 4 digit fallback pin
      
      // 🟢 DB2 EXPANSION: Exactly 20 Columns (A to T)
      var newRow = [
        newID,                  // A: UID
        params.name,            // B: Name
        params.father,          // C: Father
        "'" + inputMobile,      // D: Mobile
        inputEmail,             // E: Email
        params.password,        // F: Password
        pin,                    // G: PIN
        params.photo || "",     // H: Photo
        params.state || "",     // I: State (Reuse/Blank)
        params.address || "",   // J: Address (Full Address goes here)
        new Date(),             // K: Registration Date
        "",                     // L: Blank/Reserved
        "",                     // M: Blank/Reserved
        "ACTIVE",               // N: Status
        "",                     // O: PromoStatus
        params.dob || "",       // P: DOB (New)
        params.gender || "",    // Q: Gender (New)
        params.mother || "",    // R: Mother (New)
        params.classVal || "",  // S: Class (New)
        params.section || ""    // T: Section (New)
      ];
      
      sheet.appendRow(newRow);
      return sendJSON(true, "Registration Successful", { uid: newID });
    }

    // --- Register: Step 1 - Send OTP (Meta WhatsApp) ---
    else if (action == "sendRegisterOtp") {
      var res = sendRegisterOtp(params);
      return sendJSON(res.success, res.message);
    }

    // --- Register: Step 2 - Verify OTP & Activate Account ---
    else if (action == "verifyRegisterOtp") {
      var res = verifyRegisterOtp(params);
      return sendJSON(res.success, res.message, res.data);
    }

    // --- Dashboard Stats ---
    else if (action == "getDashboardStats") {
      var rSheet = ss.getSheetByName("Responses");
      var uSheet = ss.getSheetByName("Users");
      if (!rSheet || !uSheet) return sendJSON(false, "DB Sheets Missing");

      var rData = rSheet.getDataRange().getValues();
      var totalStudents = uSheet.getLastRow() - 1;
      var totalAttempts = Math.max(0, rData.length - 1);
      if(totalStudents < 0) totalStudents = 0;

      var totalScore = 0, passedCount = 0, subjectCounts = {}, recentActivity = [], leaderboard = [];

      for (var i = 1; i < rData.length; i++) {
        var score = parseFloat(rData[i][10]) || 0;
        var name = String(rData[i][4] || "").toUpperCase();
        totalScore += score;
        if(score >= 50) passedCount++;

        var subj = "GENERAL";
        if(name.includes("MATH")) subj = "MATHS";
        else if(name.includes("SCI") || name.includes("PHY") || name.includes("CHEM")) subj = "SCIENCE";
        else if(name.includes("ENG")) subj = "ENGLISH";
        else if(name.includes("GK")) subj = "GK";
        subjectCounts[subj] = (subjectCounts[subj] || 0) + 1;

        if(score >= 80) leaderboard.push({ name: rData[i][1], testName: rData[i][4], score: score });
      }

      var recentStart = Math.max(1, rData.length - 5);
      for(var k = rData.length - 1; k >= recentStart; k--) {
         recentActivity.push({ name: rData[k][1], testName: rData[k][4], score: rData[k][10], uid: rData[k][0] });
      }
      leaderboard.sort(function(a, b){return b.score - a.score});
      var chartData = rData.slice(Math.max(1, rData.length - 15)).map(function(r){ return {name: r[1], score: r[10]}; });

      return sendJSON(true, "Stats Fetched", {
        totalStudents: totalStudents, totalAttempts: totalAttempts, avgScore: totalAttempts ? (totalScore/totalAttempts).toFixed(1) : 0,
        passRate: totalAttempts ? ((passedCount/totalAttempts)*100).toFixed(1) : 0,
        subjectCounts: subjectCounts, recent: recentActivity, leaderboard: leaderboard.slice(0, 5), chartData: chartData
      });
    }

    // --- Get Results ---
    else if (action == "getResults") {
      var sheet = ss.getSheetByName("Responses");
      var data = sheet.getDataRange().getValues();
      var results = [];
      var targetUid = String(params.uid || '').trim();

      for (var i = 1; i < data.length; i++) {
        var rowUid = String(data[i][0]).trim();
        if (targetUid !== "" && rowUid !== targetUid) continue;

        results.push({
          uid: rowUid, name: data[i][1], chapterNumber: data[i][2], chapterName: data[i][3],
          testName: data[i][4], timestamp: data[i][5], totalQ: data[i][6], correct: data[i][7],
          incorrect: data[i][8], notAttempted: data[i][9], score: data[i][10],
          correctList: data[i][11], incorrectList: data[i][12], skippedList: data[i][13],
          timeTaken: data[i][14], className: data[i][15], testId: data[i][16], userChoices: data[i][17],
          totalTimeGiven: data[i][18], _globalID: i
        });
      }
      return sendJSON(true, "Results Fetched", results);
    }

  
    // --- Submit Result ---
    else if (action == "submitResult") {
      var sheet = ss.getSheetByName("Responses");
      
      // 🆕 PROCTORING FOLDER CREATION LOGIC (Method 3: Saving Folder ID)
      var proctorFolderId = ""; 
      
      // params.proctorSnapshots frontend se aayega
      if (params.proctorSnapshots) {
        try {
          var snapshots = JSON.parse(params.proctorSnapshots);
          
          if (snapshots && snapshots.length > 0) {
            // 1. Parent Folder dhundho ya banao
            var parentFolderName = "Exam_Proctoring_Records";
            var parentFolders = DriveApp.getFoldersByName(parentFolderName);
            var parentFolder = parentFolders.hasNext() ? parentFolders.next() : DriveApp.createFolder(parentFolderName);

            // 2. Student-Specific Folder (Name_TestID_Date)
            var safeName = String(params.name).replace(/[^a-zA-Z0-9]/g, "_"); // Special chars remove
            var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
            var subFolderName = safeName + "_" + params.testId + "_" + dateStr;
            
            var studentFolder = parentFolder.createFolder(subFolderName);
            studentFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            
            // 🔴 UPDATE HERE: URL ki jagah ID save kar rahe hain (Method 3 ke liye zaroori hai)
            proctorFolderId = studentFolder.getId(); 

            // 3. Convert all Base64 to JPEG images
            for (var k = 0; k < snapshots.length; k++) {
              var base64Str = snapshots[k];
              if (base64Str && base64Str.indexOf(",") !== -1) {
                var base64Data = base64Str.split(",")[1]; 
                var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', "Snapshot_" + (k+1) + ".jpg");
                studentFolder.createFile(blob);
              }
            }
          }
        } catch (err) {
          // Agar Drive limit ya koi error aaye toh fail na ho
          proctorFolderId = "Error: " + err.message;
        }
      }

     // 🆕 FINAL APPEND ROW
      sheet.appendRow([
        params.uid, params.name, params.chapterNumber || "1", params.chapter, params.testname, 
        new Date().toLocaleString(), params.total, params.correct, params.incorrect, params.unattempted, 
        params.score, params.qCorrect, params.qIncorrect, params.qNotAttempted, params.timeTaken, 
        params.className, params.testId, params.userAnswers || '[]', params.totalTime,
        params.timeSpent || '[]', proctorFolderId, 
        params.schoolId || "DEFAULT" // 🔴 22nd Column: SaaS Identity
      ]);


      // 🟢 ACTIVITY FEED HOOK (Location: appendRow के तुरंत बाद)
      try {
        sendPushNotification(
          "Test Attempt Submitted", 
          `${params.name} completed ${params.testname} with ${params.score}% score.`, 
          { 
            type: "EXAM_SYNC", 
            uid: params.uid, 
            testId: params.testId,
            score: params.score 
          }
        );
      } catch (e) {
        Logger.log("Feed Notification Failed: " + e.toString());
      }
      
      return sendJSON(true, "Result Saved Successfully");
    }

    // --- FETCH PROCTORING IMAGES ON DEMAND (METHOD 3) ---
    else if (action === 'getProctorImages') {
      try {
        var folderId = params.folderId;
        
        // Error handling agar id exist nahi karti ya error store hua tha
        if (!folderId || folderId.startsWith("Error")) {
            return sendJSON(false, "No valid proctoring data found.");
        }

        var folder = DriveApp.getFolderById(folderId);
        var files = folder.getFiles();
        var images = [];
        
        // Saari images ko read karke base64 mein frontend ko bhejna
        while (files.hasNext()) {
          var file = files.next();
          var blob = file.getBlob();
          var base64 = "data:image/jpeg;base64," + Utilities.base64Encode(blob.getBytes());
          images.push(base64);
        }
        
        if(images.length > 0) {
            return sendJSON(true, "Images Fetched", images);
        } else {
            return sendJSON(false, "Folder is empty.");
        }
        
      } catch(e) { 
        return sendJSON(false, "Folder access error: " + e.toString()); 
      }
    }

    
    //--------UPDATE PROFILE PIC AND PASSWORD----------
    else if (action == "updateProfile") {
      var res = updateUserProfile(params); // Separated Function Call
      return sendJSON(res.success, res.msg);
    }
    //-------- UNIVERSAL INDIVIDUAL PROFILE UPDATE ENGINE ----------
    else if (action === "updateFullProfile") {
      var res = updateUniversalProfileComplete(params);
      return sendJSON(res.success, res.msg);
    }

    // --- Search User ---
    else if (action == "searchUser") {
      var sheet = ss.getSheetByName("Users");
      var data = sheet.getDataRange().getValues();
      var query = String(params.query || '').toLowerCase().trim();
      var results = [];
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]).toLowerCase() == query || String(data[i][1]).toLowerCase().includes(query)) {
          results.push({ uid: data[i][0], name: data[i][1], father: data[i][2], mobile: data[i][3], email: data[i][4], photo: data[i][7], address: data[i][9] });
        }
      }
      return sendJSON(results.length > 0, results.length ? "Users Found" : "No match", results);
    }

    // --- Fetch Test ---
    
    else if (action == "fetchTest") {
      var sheet = ss.getSheetByName("QuestionBank");
      var data = sheet.getDataRange().getDisplayValues();
      var reqId = String(params.testId || '').trim();
      
      // 🔴 Security Gatekeeper (Admin/Teacher check)
      var isAdminCall = String(params.verifiedRole || "").toUpperCase() === "ADMIN" || String(params.verifiedRole || "").toUpperCase() === "TEACHER";
      
      // If student is fetching the test, verify status from Test_Registry
      if (!isAdminCall) {
        var regList = [];
        try { regList = readTestRegistry(); } catch(e){}
        var regRow = regList.find(function(r){ return r.testId === reqId; });
        
        // 🔴 MICRO-FIX: Sirf DRAFT ko block karein. CLOSED ko allow karein taaki purani Report khul sake!
        if (regRow && regRow.status === "DRAFT") {
          return sendJSON(false, "This test is still in Draft mode and not available.");
        }
      }

      var payload = { meta: {}, questions: [] };
      var found = false;
      
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() == reqId) {
          found = true;
          
          if (!payload.meta.testId) {
            payload.meta = { 
              testId: reqId, 
              className: data[i][1], 
              subject: data[i][2], 
              chapterNo: data[i][3], 
              chapterName: data[i][4], 
              testName: data[i][5], 
              // अगर शीट में खाली है तो डिफ़ॉल्ट 20 लेगा
              duration: data[i][6] || "20" 
            };
          }
          
          var opts = [String(data[i][9]), String(data[i][10]), String(data[i][11]), String(data[i][12])].filter(function(x) { return x.trim() !== ""; });
          
          payload.questions.push({ 
            id: data[i][7], 
            text: data[i][8], 
            options: opts, 
            correctAnswer: String(data[i][13]).trim(), 
            explanation: data[i][14],
            marks: data[i][15] || 1 // 🟢 NEW: Read Marks from 16th Column (Index 15), default to 1 if empty
          });
        }
      }
      
      return sendJSON(found, found ? "Test Loaded" : "Not Found", payload);
    }

    // --- Library Menu ---
    else if (action == "getLibraryMenu") {
      var sheet = ss.getSheetByName("QuestionBank");
      var data = sheet.getDataRange().getValues();
      var unique = {};
      for (var i = 1; i < data.length; i++) {
        var tId = String(data[i][0]).trim();
        if (tId && !unique[tId]) unique[tId] = { testId: tId, class: data[i][1], subject: data[i][2], chapter: data[i][4], testName: data[i][5], time: data[i][6] };
      }
      var list = []; for (var k in unique) list.push(unique[k]);
      return sendJSON(true, "Menu Fetched", list);
    }

        // --- Add Bulk Questions ---
    else if (action == "addBulkQuestions") {
      try {
        var rows = JSON.parse(params.rowsData || '[]');
        var sheet = ss.getSheetByName("QuestionBank");
        
        if (rows.length === 0) return sendJSON(false, "No questions found in payload.");

        var mySchoolId = params.schoolId || "DEFAULT"; // 🔴 SaaS: Proxy से आया School ID

        for (var r = 0; r < rows.length; r++) {
          if (rows[r][1]) { 
            var rawClass = String(rows[r][1]).trim();
            if (/^\d+$/.test(rawClass)) rows[r][1] = "Class " + rawClass;
            else rows[r][1] = rawClass;
          }
          // 🔴 17वें कॉलम में schoolId जोड़ें ताकि डेटा मिक्स न हो
          rows[r].push(mySchoolId); 
        }
        
        var targetRange = sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length);
        targetRange.setNumberFormat("@");
        targetRange.setValues(rows);
        
        registerTestFromRows(rows, { section: params.section || 'ALL', createdBy: params.createdBy || 'Admin', schoolId: mySchoolId });
        sendPushNotification("New Question Bank Added", `Added ${rows.length} questions.`, { type: "EXAM_SYNC", count: rows.length });
        
        return sendJSON(true, "Added " + rows.length + " questions securely.");
      } catch (err) { return sendJSON(false, err.toString()); }
    }



    // --- TEST CONTROL CENTER ACTIONS ---
    else if (action === 'getTestRegistry') {
      try {
        var registryData = getTestRegistryWithStats(params.schoolId);
        return sendJSON(true, "Registry Synced", registryData);
      } catch (err) {
        // 🟢 Failsafe: Return empty array so frontend doesn't break, log error
        return sendJSON(false, "Registry Read Error: " + err.message, []);
      }
    }

    else if (action === 'updateTestStatus') {
      var res = updateTestStatus(params.testId, params.status);
      return sendJSON(res.success, res.message);
    }
    else if (action === 'updateTestMeta') {
      var res = updateTestMeta(params);
      return sendJSON(res.success, res.message);
    }
    else if (action === 'deleteTestCompletely') {
      var res = deleteTestCompletely(params.testId);
      return sendJSON(res.success, res.message);
    }
    else if (action === 'getTestAttemptsList') {
      var attemptsData = getTestAttemptsList(params.testId, params.schoolId); // 🔴 Pass School ID
      return sendJSON(true, "Attempts Fetched", attemptsData);
    }

    else if (action === 'deleteResultEntry') {
      var res = deleteResultEntry(params);
      return sendJSON(res.success, res.message);
    }

    // --- Database Dump ---
    else if (action == "getDatabaseDump") {
      var dumpData = getDatabaseDump(); // Helper call
      return sendJSON(!dumpData.error, "Dump Fetched", dumpData);
    }

    // --- History ---
    else if (action === 'getHistory') {
      var result = getStudentSubjectHistory(params.uniqueId, params.subjectKey); // Helper call
      return sendJSON(result.status, "History Fetched", result.data);
    }

    // --- Planner Save ---
    else if (action == "plannerSave") {
      var sheet = ss.getSheetByName("Planer");
      var pid = String(params.Pid || '').trim();
      var data = sheet.getDataRange().getValues();
      var rowIndex = -1; var existingRow = null;
      if (pid) {
        for (var i = 1; i < data.length; i++) { if (String(data[i][0]) == pid) { rowIndex = i+1; existingRow = data[i]; break; } }
      }
      // Lock Check
      if (rowIndex > -1 && existingRow[18] == 1 && String(existingRow[14]) !== String(params.uid)) {
         sheet.getRange(rowIndex, 13).setValue(params.done);
         sheet.getRange(rowIndex, 14).setValue(params.status);
         return sendJSON(true, "Status Updated (Locked)");
      }
      var newPid = pid || ("PL_" + Date.now());
      var now = new Date().toISOString();
      var row = [
        newPid, params['User ID'], params.FullName, params.FatherName, params.MobileNo, params.EmailID, params.date, params.start_time,
        params.target_text, params.target_type, params.priority, params.estimated_minutes, params.done||0, params.status||'pending',
        (rowIndex==-1)?params.uid:(existingRow?existingRow[14]:params.uid), (rowIndex==-1)?now:(existingRow?existingRow[15]:now),
        params.uid, now, params.admin_lock||0, 1, '', '{}'
      ];
      if (rowIndex === -1) sheet.appendRow(row);
      else sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
      return sendJSON(true, rowIndex===-1?"Created":"Updated", { Pid: newPid });
    }

    // --- Planner Get ---
    else if (action == "plannerGet") {
      var sheet = ss.getSheetByName("Planer");
      var data = sheet.getDataRange().getValues();
      var tasks = [];
      var targetUid = String(params.uid || '').trim();
      var tz = Session.getScriptTimeZone();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][1]).trim() === targetUid && data[i][19] != 0) {
          var dStr = (data[i][6] instanceof Date) ? Utilities.formatDate(data[i][6], tz, "yyyy-MM-dd") : String(data[i][6]).substring(0,10);
          tasks.push({ Pid: data[i][0], date: dStr, start_time: data[i][7], target_text: data[i][8], target_type: data[i][9], priority: data[i][10], done: data[i][12], status: data[i][13], admin_lock: data[i][18] });
        }
      }
      return sendJSON(true, "Fetched", tasks);
    }

    // --- Planner Delete ---
    else if (action == "plannerDelete") {
      var sheet = ss.getSheetByName("Planer");
      var pid = String(params.Pid).trim();
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) == pid) {
          if (data[i][18] == 1 && String(data[i][14]) !== String(params.uid)) return sendJSON(false, "Locked");
          sheet.deleteRow(i + 1);
          return sendJSON(true, "Deleted");
        }
      }
      return sendJSON(false, "Not Found");
    }

    // --- Notices & Syllabus (Standard Ops) ---
    else if (action == "getSyllabus") {
      var data = ss.getSheetByName("Syllabus").getDataRange().getValues();
      var list = [];
      for(var i=1; i<data.length; i++) {
        if(data[i][0]) list.push({ id: data[i][0], class: data[i][1], subject: data[i][2], title: data[i][3], link: data[i][4], timestamp: data[i][5] });
      }
      return sendJSON(true, "Fetched", list);
    }
    else if (action == "deleteSyllabus") {
      var sheet = ss.getSheetByName("Syllabus");
      var data = sheet.getDataRange().getValues();
      for(var i=1; i<data.length; i++) { if(String(data[i][0]) == params.id) { sheet.deleteRow(i+1); return sendJSON(true, "Deleted"); } }
      return sendJSON(false, "Not Found");
    }
    else if (action == "getNotices") {
      var data = ss.getSheetByName("Notices").getDataRange().getValues();
      var list = [];
      for(var i=1; i<data.length; i++) {
        if(data[i][0]) list.push({ id: data[i][0], title: data[i][1], message: data[i][2], date: data[i][3], link: data[i][4], type: data[i][5] });
      }
      return sendJSON(true, "Fetched", list);
    }
    else if (action == "deleteNotice") {
      var sheet = ss.getSheetByName("Notices");
      var data = sheet.getDataRange().getValues();
      for(var i=1; i<data.length; i++) { if(String(data[i][0]) == params.id) { sheet.deleteRow(i+1); return sendJSON(true, "Deleted"); } }
      return sendJSON(false, "Not Found");
    }

     // --- Notices & Syllabus (Standard Ops) ---
    else if (action == "getSyllabus") {
      try {
        var syllabusSheet = getDB2().getSheetByName("Syllabus");
        
        // Failsafe: Agar sheet galti se delete ho gayi ho ya naam alag ho
        if (!syllabusSheet) {
          return sendJSON(false, "Error: 'Syllabus' tab not found in DB2 Spreadsheet.");
        }
        
        var data = syllabusSheet.getDataRange().getValues();
        var list = [];
        for(var i=1; i<data.length; i++) {
          if(data[i][0]) {
            list.push({ 
              id: data[i][0], 
              class: data[i][1], 
              subject: data[i][2], 
              title: data[i][3], 
              link: data[i][4], 
              timestamp: data[i][5] 
            });
          }
        }
        return sendJSON(true, "Fetched Successfully", list);
      } catch(err) {
        return sendJSON(false, "Internal Core Error: " + err.toString());
      }
    }
     // 🟢 FIXED: Yahan pehle }} tha, ab sirf ek } hai taaki rasta block na ho
    
    else if (action === "uploadSyllabus") {
      return handleSyllabusUpload(params, getDB2());
    }
    else if (action === "addNotice") {
      return handleNoticeUpload(params, getDB2());
    }


       //=============================================================================
       // 4 ALL ACTIONS OF NEW RESULT SHEET 3
       //============================================================================
       
      //---------- SAVE RESULT LOGS (To DB3: Result_Logs)
  else if (action == "saveResultLog") {
    try {
      // 1. Parse Data
      var rawData = params.payload;
      var resultData = JSON.parse(rawData); // Array from Frontend

      // 2. Connect to DB3
      // Note: 'getDB3()' function aapki script m pehle se hona chahiye
      var ss = getDB3(); 
      var sheetName = "Result_Logs";
      var sheet = ss.getSheetByName(sheetName);
      
      // 3. Auto-Create Sheet if missing (Safety Check)
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        sheet.appendRow([
          "UID", "Roll_No", "Name", "Class", "Section", 
          "Exam_Term", "Subject", "Max_Marks", "Obtained_Marks", 
          "Timestamp", "Uploaded_By"
        ]);
        // Basic Formatting
        sheet.getRange(1,1,1,11).setFontWeight("bold").setBackground("#e0e7ff");
      }

      // 4. Prepare Data Rows (Mapping JSON to Columns)
      var rows = resultData.map(function(r) {
        return [
          r.uid,           // Col 1: UID
          r.roll,          // Col 2: Roll No
          r.name,          // Col 3: Name
          r.classVal,      // Col 4: Class
          r.section,       // Col 5: Section
          r.exam,          // Col 6: Exam Term
          r.subject,       // Col 7: Subject
          r.maxMarks,      // Col 8: Max Marks
          r.marks,         // Col 9: Obtained Marks
          new Date(),      // Col 10: Timestamp (Date + Time)
          r.uploadedBy     // Col 11: Teacher Name
        ];
      });

      // 5. Bulk Write (Fastest Method)
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      }

      return sendJSON(true, "Result Uploaded Successfully!");

    } catch (e) {
      return sendJSON(false, "Server Error: " + e.message);
    }
  }  

  else if (action === 'getGlobalAnalysis') {
    const res = getGlobalSchoolData(params.examName); // Jo function humne pehle banaya tha
    return ContentService.createTextOutput(JSON.stringify({success: true, data: res}))
    .setMimeType(ContentService.MimeType.JSON);
  }

  else if (action === 'getDeepDive') {
    const res = getStudentDeepAnalysis(params.uid, params.examName);
     return ContentService.createTextOutput(JSON.stringify({success: true, data: res}))
    .setMimeType(ContentService.MimeType.JSON);
  }

  else if (action === 'getSubjectAnalysisData') {
    // params से classVal, section और examName लेना
    const res = getSubjectAnalysisData(params.classVal, params.section, params.examName);
  
    // Response को JSON फॉर्मेट में वापस भेजना
    return ContentService.createTextOutput(JSON.stringify({success: true, data: res}))
    .setMimeType(ContentService.MimeType.JSON);
  }
  

  // ======================================================
    // 6. NEW EMAIL NOTIFICATION ACTIONS
    // ======================================================
    
 
    else if (action === 'sendAbsentEmail') {
       var student = fetchStudentProfile(params.uid); 
      var config = getMasterConfig(); 
    
       // Formatting Date: 09 January 2026
      var formattedDate = Utilities.formatDate(new Date(), "GMT+5:30", "dd MMMM yyyy");

      // Attractive HTML Generate karein
       var emailBody = generateAttractiveAbsentHtml(student, config, formattedDate);

      // Email Send
       var emailRes = sendBrandedEmail(student.email, "Attendance Alert: " + student.name, "ABSENT", emailBody); 

      // WhatsApp Send (Professional 3-variable template)
       var whatsappRes = sendWhatsAppAbsentAlert(student.contact, student.name);

       var finalStatus = emailRes && whatsappRes;
     return sendJSON(finalStatus, finalStatus ? "Email & WhatsApp Delivered" : "Delivery Error");
    }

    
    else if (action === 'sendFeeEmail') {
      var student = fetchStudentProfile(params.uid);
      var body = "<p>Fee received for <b>" + params.month + "</b></p><h4>Amount: ₹" + params.amount + "</h4>";
      
      var res = sendBrandedEmail(student.email, "Fee Receipt", "FEE", body);
      return sendJSON(res, res ? "Receipt Mailed" : "Failed");
    }

    else if (action === 'pushResultEmail') {
      // Isme hum result ka data aur profile merge karenge
      const res = processResultEmail(params.uid, params.examName);
      return sendJSON(res.success, res.message);
    }

   // ======================================================
    // 5.DB4 ACTUAL SHEET FINANCE ACTIONS (DIRECT FETCH)
    // ======================================================

  // ====================================================================
    // 💳 RAZORPAY STEP 1: CREATE ORDER (SECURE)
    // ====================================================================
    else if (action === 'createRazorpayOrder') {
      try {
        if (String(params.verifiedRole).toUpperCase() !== 'STUDENT') return sendJSON(false, "Unauthorized");

        var conf = getMasterConfig();
        var amountInPaise = Math.round(parseFloat(params.amount) * 100); 

        var payload = {
          amount: amountInPaise,
          currency: "INR",
          receipt: "RCP_" + params.uid + "_" + Date.now(),
          payment_capture: 1 
        };

        var options = {
          method: "POST",
          headers: {
            "Authorization": "Basic " + Utilities.base64Encode(conf.rzpKeyId + ":" + conf.rzpSecret),
            "Content-Type": "application/json"
          },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        };

        var res = UrlFetchApp.fetch("https://api.razorpay.com/v1/orders", options);
        var rzpData = JSON.parse(res.getContentText());
        
        if (rzpData.id) {
          // Frontend ko Order ID aur Public Key_ID bhejna
          return sendJSON(true, "Order Created", { orderId: rzpData.id, amount: rzpData.amount, key: conf.rzpKeyId });
        } else {
          return sendJSON(false, "Gateway Error: " + (rzpData.error ? rzpData.error.description : "Failed"));
        }
      } catch (e) {
        return sendJSON(false, "Order Creation Failed: " + e.message);
      }
    }

    // ====================================================================
    // 💳 RAZORPAY STEP 2: VERIFY & INJECT INTO EXISTING LOGIC
    // ====================================================================
    else if (action === 'verifyAndSubmitOnlineFee') {
      try {
        if (String(params.verifiedRole).toUpperCase() !== 'STUDENT') return sendJSON(false, "Unauthorized");

        var conf = getMasterConfig();
        var orderId = params.razorpay_order_id;
        var paymentId = params.razorpay_payment_id;
        var signature = params.razorpay_signature;

        // 1. 🔒 CRYPTOGRAPHIC VERIFICATION
        var generatedSignature = Utilities.computeHmacSha256Signature(orderId + "|" + paymentId, conf.rzpSecret)
          .map(function(chr) { return (chr + 256).toString(16).slice(-2); }).join('');

        if (generatedSignature !== signature) {
          return sendJSON(false, "SECURITY BREACH: Invalid Payment Signature!");
        }

        // 2. 🚀 HIJACK EXISTING FUNCTION (`processTransactionWithFile`)
        // Frontend ne hume baki details (uid, name, amount, month) di hain
        // Hum manually unhe secure values se override kar rahe hain
        
        params.mode = "RAZORPAY/ONLINE";
        params.trxId = paymentId;          // Razorpay ka ID sheet me jayega
        params.operator = "Self Checkout"; // Taaki pata chale student ne khud pay kiya

        // Seedha aapka pehle se bana banaya function call kar diya! (Isme PDF/Email sab hai)
        var finalRes = processTransactionWithFile(params, "STUDENT");

        // Wapas Frontend ko success message de diya
        return sendJSON(finalRes.success, finalRes.message, finalRes.data);

      } catch (e) {
        return sendJSON(false, "Payment Verification Failed: " + e.message);
      }
    }  

    // A. Dashboard: All Classes & Staff Grand Totals
    else if (action === 'getFinanceGlobalStats') {
      return sendJSON(true, "Global Stats Fetched", getFinanceGlobalStats());
    }

    // B. Class Analytics: Monthly Data + Footer Row Stats
    else if (action === 'getClassFinanceDetails') {
      const res = getClassFinanceDetails(params.classVal, params.section, params.monthName);
      return sendJSON(true, "Class Data Fetched", res);
    }
    
    // --- STAFF PAYROLL MATRIX ACTION ---
    else if (action === 'getStaffMonthlyMatrix') {
      const result = getStaffMonthlyMatrix(params.monthName);
      // Seedha response bhejein
      return ContentService.createTextOutput(JSON.stringify(result))
             .setMimeType(ContentService.MimeType.JSON);
    }

    
    // C. Student Deep Dive: Full 12 Month History by ID (SECURED FOR STUDENT PORTAL)
    else if (action === 'getStudentFinDeepDive') {
      try {
        // 🔒 ZERO-TRUST SECURITY: Student sirf apni fees dekh sakega
        if (String(params.verifiedRole).toUpperCase() === 'STUDENT') {
          var profile = fetchStudentProfile(params.uid);
          if (!profile || String(profile.email).trim().toLowerCase() !== String(params.verifiedEmail).trim().toLowerCase()) {
            return sendJSON(false, "Security Breach: Unauthorized Ledger Access.");
          }
        }
        
        var res = getStudentFinDeepDive(params.uid);
        if (res) {
          return sendJSON(true, "Student History Fetched", res);
        } else {
          return sendJSON(false, "No financial records found.");
        }
      } catch (e) {
        return sendJSON(false, "Finance Fetch Error: " + e.message);
      }
    }

    // D. Staff Deep Dive: Full 12 Month Payroll by ID
    else if (action === 'getStaffFinDeepDive') {
      const res = getStaffFinDeepDive(params.uid);
      return sendJSON(true, "Staff Payroll Fetched", res);
    }


    // E. Student Fee Submit (Log + File Save)
    else if (action === 'submitFeeTransaction') {
      
      const res = processTransactionWithFile(params, "STUDENT"); 
      
      // Response seedha SPA ko jayega success message ke saath
      return sendJSON(res.success, res.message, res.data);
    }

    // F. Staff Salary Submit (Log + File Save)
    else if (action === 'submitSalaryTransaction') {
      const res = processTransactionWithFile(params, "STAFF");
      return sendJSON(res.success, res.message, res.data);
    }
    else if (action === 'getOpsExpenses') {
      return sendJSON(true, "Fetched", getOpsExpenses(params.monthName));
    }
    else if (action === 'saveExpenseEntry') {
     return sendJSON(true, "Saved", saveExpenseEntry(params));
    }

    // --- FINANCE MASTER DASHBOARD ACTION ---
    else if (action === 'getFinanceDashboardData') {
  
     const res = getFinanceDashboardData(params.monthName);
  
     return sendJSON(res.success, res.success ? "Data Bridge Intelligence Synced" : res.message, res);
    }
   
    // ======================================================
    // 6. DB5 ARRANGEMENT & TIMETABLE ACTIONS
    // ======================================================

    else if (action === 'getArrangementDraft') {
     // Frontend se "yyyy-MM-dd" format mein date aayegi
     var res = generateArrangementDraft(params.date); 
     return sendJSON(res.success, res.message || "Draft Processed", res.data);
    }

    else if (action === 'confirmSubstitution') {
     try {
     // Array of objects from SPA
      var payloadData = JSON.parse(params.payload); 
      var res = saveSubstitutionLogs(payloadData);
      return sendJSON(res.success, res.message);
     } catch (e) {
      return sendJSON(false, "Parsing Error: " + e.message);
     }
    }
  
    else if (action === 'getLiveMatrix') {
      return getLiveMatrix(e); 
    }
     // ======================================================
    // 🟢 NEW: MASTER DATA FETCHER (Replaces old logic)
    // ======================================================
    else if (action === 'getArrangementMasterData') {
     
      var res = getArrangementMasterData(params.date); 
      return sendJSON(res.success, res.message || "Master Data Fetched", res.data);
    }

    // ======================================================
    // 7. DB7 - LIBRARY MANAGEMENT ACTIONS
    // ======================================================

     // A. 3-STEP MEMBER VERIFICATION (Student/Teacher/Member)
    else if (action === 'verifyMember') {
      const res = verifyMemberMaster(params.id);
      return sendJSON(res.verified, res.verified ? "Member Verified" : res.message, res);
    }

    // B. BOOK DISCOVERY (Check Local DB first, then Google API)
    else if (action === 'discoverBook') {
      const res = searchBookDiscovery(params.isbn);
      return sendJSON(true, "Discovery Complete", res);
    }

      // C. REGISTER NEW BOOK (Saves form data to Inventory)
    else if (action === 'addBookToLibrary') {
      const res = registerNewBook(params.bookData);
      return sendJSON(res.success, "Book Registered Successfully", res);
    }

    // D. ISSUE BOOK (Updates Inventory & Transaction Logs)
    else if (action === 'issueLibraryBook') {
      // params.data should have: bookId, title, memberId, memberName, adminName
      const res = executeIssueAction(params.data);
      return sendJSON(res.success, res.message);
    }

    // E. FETCH ACTIVE ISSUES (For Return Module - Single/Bulk)
    else if (action === 'getReturnList') {
      const list = fetchReturnDetails(params.id); // Search by Book ID or Member ID
      const msg = list.length > 0 ? "Active Issues Found" : "No active issues for this ID";
      return sendJSON(list.length > 0, msg, list);
    }

    // F. RETURN BOOK (Updates Status to Available & Closes Trx)
    else if (action === 'returnLibraryBook') {
      // params.bookIds should be an Array [id1, id2...] for Bulk Return
      const res = executeReturnAction(params.bookIds, params.adminName);
      return sendJSON(res.success, "Return(s) Processed Successfully");
    }

    // G. GET LIBRARY DASHBOARD (Optional: For Grid View)
    else if (action === 'getLibraryInventory') {
      const inventory = fetchLibraryInventory();
      return sendJSON(true, "Inventory Synced", inventory);
    }
    else if (action === 'saveDailyLog') {
    const res = saveTeacherDailyLog(params);
    return sendJSON(res.success, res.message);
    }
    else if (action === 'getMyDailyLogs') {
    const res = getTeacherDailyLogs(params.uid, params.month);
    return sendJSON(res.success, res.message, res.data);
    }



    
    // --- Unknown Action ---
    else {
      return sendJSON(false, "Invalid Action: " + action);
    }

  } catch (err) {
    return sendJSON(false, "Error: " + err.toString());
  } finally {
    lock.releaseLock();
  }
}


 /**
 * ============================================================================
 * 🫀 COMMAND CENTER — Lightweight Aggregator for Landing Page Heart
 * Reuses EXISTING functions/data (attendance logs, finance globals, exam
 * ledger) instead of re-scanning sheets from scratch — isliye fast rehta hai.
 * ============================================================================
 */
function getCommandCenterStats() {
  try {
    const db1 = getDB1();
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    // ── 1. TODAY'S ATTENDANCE BREAKDOWN (P/A/L/OD) ──
    const att = { P: 0, A: 0, L: 0, OD: 0 };
    try {
      const attSheet = db1.getSheetByName("Attendance_Logs");
      if (attSheet && attSheet.getLastRow() > 1) {
        // Sirf zaroori columns padho (Date + Status), poori sheet nahi
        const lastRow = attSheet.getLastRow();
        const scanStart = Math.max(2, lastRow - 800); // last ~800 rows hi kaafi hain (aaj ka data)
        const data = attSheet.getRange(scanStart, 1, lastRow - scanStart + 1, 7).getValues();
        data.forEach(r => {
          if (formatSheetDate(r[0]) === today) {
            const st = String(r[6]).trim().toUpperCase();
            if (att[st] !== undefined) att[st]++;
          }
        });
      }
    } catch (e) { /* attendance optional, don't break whole widget */ }

    // ── 2. FEE SNAPSHOT (reuses existing getFinanceGlobalStats) ──
    let fee = { collected: 0, pending: 0 };
    try {
      const finStats = getFinanceGlobalStats();
      fee.collected = Math.round(finStats.studentPaid || 0);
      fee.pending = Math.round(finStats.studentDue || 0);
    } catch (e) { /* finance optional */ }

    // ── 3. EXAM SYNC HEALTH (reuses existing getExamControlLedger) ──
    const examSync = { queued: 0, completed: 0, error: 0, total: 0 };
    try {
      const ledger = getExamControlLedger();
      if (ledger.status && ledger.data) {
        ledger.data.forEach(ex => {
          const s = String(ex.syncStatus || "").toUpperCase();
          examSync.total++;
          if (s === "QUEUED" || s === "PENDING") examSync.queued++;
          else if (s === "COMPLETED") examSync.completed++;
          else if (s === "COMPLETED_WITH_ERRORS") { examSync.completed++; examSync.error++; }
        });
      }
    } catch (e) { /* exam ledger optional */ }

    return {
      status: true,
      data: { attendance: att, fee: fee, examSync: examSync, generatedAt: new Date().toISOString() }
    };
  } catch (e) {
    return { status: false, message: "Command Center Error: " + e.toString() };
  }
}



/**
 * ============================================================================
 * ⚙️ CONFIG CONSTANTS
 * ============================================================================
 */
const QUEUE_CONFIG = {
  BATCH_SIZE: 3,
  TRIGGER_DELAY_MS: 15 * 1000,
  PROP_QUEUE_PREFIX: "examQueue_",
  PROP_META_PREFIX: "examMeta_",
  PROP_ACTIVE_JOB: "activeExamJobId",
  TRIGGER_HANDLER: "processExamQueueBatch",
  ERROR_LOG_SHEET: "Error_Log",
  NOTIFY_SHEET: "Notifications"
};

/**
 * ============================================================================
 * 1. FETCH LEDGER MATRIX — Q24:X36 (8 columns: name,tiers,status,visibility,
 *    U-unused,maxMarks,syncStatus,lastError)
 * ============================================================================
 */
function getExamControlLedger() {
  try {
    const ss = getDB0();
    const sh = ss.getSheetByName("Master_Config");
    if (!sh) return { status: false, message: "Master_Config tab missing in DB0" };

    const startRow = 24;
    const startCol = 17; // Q
    const numRows = 13;
    const numCols = 8;   // Q,R,S,T,U,V,W,X

    const rawData = sh.getRange(startRow, startCol, numRows, numCols).getValues();
    const activeExams = [];

    rawData.forEach(function (row) {
      var name = String(row[0]).trim();
      if (name === "" || name === "null" || name === "undefined") return;

      activeExams.push({
        name: name,                                                    // Q
        tiers: String(row[1] || "").trim(),                            // R
        status: String(row[2] || "OPEN").toUpperCase().trim(),         // S
        visibility: String(row[3] || "HIDDEN").toUpperCase().trim(),   // T
        // row[4] = U — unused, jaan-boojh kar chhoda gaya
        maxMarks: Number(row[5] || 80),                                // V
        syncStatus: String(row[6] || "PENDING").toUpperCase().trim(),  // W
        lastError: String(row[7] || "").trim()                         // X
      });
    });

    return { status: true, data: activeExams };
  } catch (e) {
    return { status: false, message: "Ledger Engine Error: " + e.toString() };
  }
}

/**
 * ============================================================================
 * 🚀 ENTRY POINT — FRONTEND YAHI FUNCTION CALL KAREGA
 * ============================================================================
 */
function initializeNewExamTerm(params) {
  const lock = LockService.getScriptLock();
  lock.tryLock(15000);

  try {
    const db0 = getDB0();
    const db1 = getDB1();
    const db3 = getDB3();
    const config = getMasterConfig();
    const sh = db0.getSheetByName("Master_Config");
    if (!sh) return { status: false, message: "Master_Config tab missing in DB0" };

    const examName = String(params.examName).toUpperCase().trim();
    const maxMarks = Number(params.maxMarks || 80);
    const initialStatus = String(params.status || "OPEN").toUpperCase();
    const targetClassesString = String(params.tiers || "").trim();

    if (examName === "") return { status: false, message: "Exam Title cannot be blank" };
    if (targetClassesString === "") return { status: false, message: "No classes selected" };

    // ── 1. BOUNDARY DETECTION (Q24:X36 Ledger Lock) ──
    const totalRows = sh.getMaxRows();
    const colQValues = sh.getRange(1, 17, totalRows, 1).getValues();
    let actualLastRow = 0;
    for (let r = colQValues.length - 1; r >= 0; r--) {
      if (String(colQValues[r][0]).trim() !== "") { actualLastRow = r + 1; break; }
    }

    if (actualLastRow >= 24) {
      const startScanRow = 24;
      const endScanRow = Math.min(actualLastRow, 36);
      if (endScanRow >= startScanRow) {
        const existingNames = sh.getRange(startScanRow, 17, endScanRow - startScanRow + 1, 1)
          .getValues().map(r => String(r[0]).toUpperCase().trim());
        if (existingNames.indexOf(examName) > -1) {
          return { status: false, message: `Exam '${examName}' already exists in ledger Matrix.` };
        }
      }
    }

    // ── 2. FETCH ACADEMIC MATRIX MAP ──
    const academicRaw = sh.getRange(5, 17, 18, 22).getValues();
    const academicMap = buildAcademicMap(academicRaw);

    // ── 3. WRITE LEDGER ROW (Q,R,S,T identity+admin fields | V maxMarks | W sync | X error) ──
    const nextAvailableRow = Math.max(actualLastRow + 1, 24);
    if (nextAvailableRow > 36) {
      return { status: false, message: "Ledger Limit Exceeded! Row boundary locked at V36." };
    }

    sh.getRange(nextAvailableRow, 17, 1, 4).setValues([[examName, targetClassesString, initialStatus, "HIDDEN"]]); // Q-T
    sh.getRange(nextAvailableRow, 22).setValue(maxMarks); // V
    sh.getRange(nextAvailableRow, 23).setValue("QUEUED"); // W — build/sync status
    sh.getRange(nextAvailableRow, 24).setValue("");       // X — error summary (blank initially)
    sh.getRange(nextAvailableRow, 17, 1, 8).setFontFamily("Outfit").setFontSize(10).setVerticalAlignment("middle");
    sh.getRange(nextAvailableRow, 17).setFontWeight("bold");

    // ── 4. BUILD TASK QUEUE ──
    const studentSheet = db1.getSheetByName("Student_Data");
    if (!studentSheet) return { status: false, message: "Student_Data tab missing in DB1" };
    const studentRawData = studentSheet.getRange(6, 1, studentSheet.getLastRow() - 5, 7).getValues();

    const tasks = buildTaskQueueForExam(examName, targetClassesString, academicMap, studentRawData, config, db3);

    if (tasks.length === 0) {
      sh.getRange(nextAvailableRow, 23).setValue("COMPLETED"); // W column
      return { status: true, message: `Exam '${examName}' ledger created, but no matching students found — nothing to build.` };
    }

    // ── 5. QUEUE + META KO PROPERTIES ME SAVE KARO ──
    const jobId = Utilities.getUuid();
    const jobMeta = {
      jobId: jobId,
      examName: examName,
      ledgerRow: nextAvailableRow,
      total: tasks.length,
      completed: 0,
      failed: [],
      startedAt: new Date().toISOString()
    };

    const props = PropertiesService.getScriptProperties();
    props.setProperty(QUEUE_CONFIG.PROP_QUEUE_PREFIX + jobId, JSON.stringify(tasks));
    props.setProperty(QUEUE_CONFIG.PROP_META_PREFIX + jobId, JSON.stringify(jobMeta));

    // ── 6. PEHLA BATCH TURANT + BAAKI RECURRING TRIGGER SE ──
    scheduleNextBatch(jobId, 1000);

    return {
      status: true,
      message: `Exam '${examName}' created. Table generation started in background for ${tasks.length} sheet(s).`,
      jobId: jobId
    };

  } catch (e) {
    return { status: false, message: "Central Matrix Error: " + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * 🧩 HELPER: Academic Matrix Parser
 * ============================================================================
 */
function buildAcademicMap(academicRaw) {
  const academicMap = {};
  academicRaw.forEach(function (row) {
    var rawClass = row[0];
    if (rawClass === "" || rawClass === null || rawClass === undefined) return;
    var className = String(rawClass).trim().toUpperCase();
    if (className.includes("TEST") || className.includes("EXAM") || className.includes("HALF")) return;

    const mainSubs = [];
    const skillSubs = [];
    let hitBlankBoundary = false;
    const subjectsRowData = row.slice(2);

    for (let sIdx = 0; sIdx < subjectsRowData.length; sIdx++) {
      const currentSub = String(subjectsRowData[sIdx] || "").trim();
      if (currentSub === "" || currentSub === "N/A" || currentSub === "0" || currentSub === "FALSE") {
        hitBlankBoundary = true;
        continue;
      }
      if (!hitBlankBoundary) mainSubs.push(currentSub);
      else skillSubs.push(currentSub);
    }

    var rawSections = String(row[1] || "").trim();
    var sections = rawSections === "" ? ["A"] : rawSections.split(",").map(s => s.trim().toUpperCase()).filter(s => s !== "");

    academicMap[className] = { sections: sections, mainSubs: mainSubs, skillSubs: skillSubs };
  });
  return academicMap;
}

/**
 * ============================================================================
 * 🧩 HELPER: Task Queue Builder
 * ============================================================================
 */
function buildTaskQueueForExam(examName, targetClassesString, academicMap, studentRawData, config, db3) {
  const tasks = [];
  const classesToBuild = targetClassesString.split(',');

  classesToBuild.forEach(function (cls) {
    const cleanClsKey = String(cls).trim().toUpperCase();
    const matchKey = Object.keys(academicMap).find(k => parseInt(k) === parseInt(cleanClsKey) || k === cleanClsKey);
    if (!matchKey) return;

    const targetData = academicMap[matchKey];
    const sections = targetData.sections;
    const mainSubs = targetData.mainSubs;
    const skillSubs = targetData.skillSubs;
    const clsInt = parseInt(cls);

    sections.forEach(function (sec) {
      const currentStudents = studentRawData.filter(r => {
        let c = String(r[5] || "").trim();
        let s = String(r[6] || "").trim().toUpperCase();
        return (c == cls || c == cls + "th") && s == sec;
      }).map(r => ({ id: r[0], roll: Number(r[1] || 0), name: r[2] })).sort((a, b) => a.roll - b.roll);

      if (currentStudents.length === 0) return;

      tasks.push({
        examName: examName,
        cls: String(cls).trim(),
        clsInt: clsInt,
        sec: sec,
        sheetName: `${cls}${sec}-${config.currentSession}`,
        mainSubs: mainSubs,
        skillSubs: skillSubs,
        students: currentStudents,
        engine: decideEngineForClass(clsInt, mainSubs)
      });
    });
  });

  return tasks;
}

/**
 * ============================================================================
 * 🧠 ROUTER BRAIN
 * ============================================================================
 */
function decideEngineForClass(clsInt, mainSubs) {
  if (clsInt <= 8) return "JUNIOR";
  if (clsInt <= 10) return "SENIOR";

  const hasScience = mainSubs.some(s => {
    const c = String(s).toLowerCase();
    return c.includes("physics") || c.includes("chemistry") || c.includes("biology");
  });
  return hasScience ? "SR_SEC_SCIENCE" : "SR_SEC_ARTS";
}

/**
 * ============================================================================
 * ⏱️ BATCH PROCESSOR — TRIGGER SE CALL HOTA HAI
 * ============================================================================
 */
function processExamQueueBatch(e) {
  const props = PropertiesService.getScriptProperties();
  const jobId = props.getProperty(QUEUE_CONFIG.PROP_ACTIVE_JOB);
  if (!jobId) {
    deleteTriggersByFunctionName(QUEUE_CONFIG.TRIGGER_HANDLER);
    return;
  }

  const queueKey = QUEUE_CONFIG.PROP_QUEUE_PREFIX + jobId;
  const metaKey = QUEUE_CONFIG.PROP_META_PREFIX + jobId;

  const queueRaw = props.getProperty(queueKey);
  const metaRaw = props.getProperty(metaKey);
  if (!queueRaw || !metaRaw) {
    deleteTriggersByFunctionName(QUEUE_CONFIG.TRIGGER_HANDLER);
    return;
  }

  let tasks = JSON.parse(queueRaw);
  let meta = JSON.parse(metaRaw);

  if (tasks.length === 0) {
    finalizeExamJob(jobId, meta);
    return;
  }

  let db3, config;
  try {
    db3 = getDB3();
    config = getMasterConfig();
  } catch (dbErr) {
    logExamError("SYSTEM", "-", "-", "❌ DB CONNECTION FAILED INSIDE TRIGGER: " + dbErr.toString());
    return;
  }

  const batch = tasks.splice(0, QUEUE_CONFIG.BATCH_SIZE);

  batch.forEach(function (task) {
    try {
      let sheet = db3.getSheetByName(task.sheetName);
      if (!sheet) {
        sheet = db3.insertSheet(task.sheetName);
        let maxC = sheet.getMaxColumns();
        if (maxC < 150) sheet.insertColumnsAfter(maxC, 150 - maxC);
      }

      const lastCol = sheet.getLastColumn();
      const sCol = lastCol <= 3 ? 1 : lastCol + 2;

      let blockWidth = runEngine(task.engine, sheet, sCol, task.examName, task.students, task.mainSubs, task.skillSubs, config, task.sec);

      sheet.setRowHeight(1, 65);
      sheet.setRowHeight(2, 45);
      sheet.setRowHeight(4, 25);
      sheet.setRowHeight(5, 25);
      sheet.getRange(1, sCol, 5, blockWidth).setFontFamily("Outfit").setVerticalAlignment("middle");

      meta.completed++;
    } catch (err) {
      meta.failed.push({ cls: task.cls, sec: task.sec, sheetName: task.sheetName, error: err.toString() });
      logExamError(task.examName, task.cls, task.sec, err.toString());
    }
  });

  props.setProperty(queueKey, JSON.stringify(tasks));
  props.setProperty(metaKey, JSON.stringify(meta));

  if (tasks.length === 0) {
    finalizeExamJob(jobId, meta);
  }
  // agar tasks.length > 0 hai, recurring trigger apne aap 1 min baad phir chalega
}

/**
 * ============================================================================
 * 🧩 HELPER: Engine Executor
 * ============================================================================
 */
function runEngine(engine, sheet, sCol, examName, students, mainSubs, skillSubs, config, sec) {
  switch (engine) {
    case "JUNIOR":
      return buildDynamicJuniorBlock(sheet, sCol, examName, students, mainSubs, skillSubs, config);
    case "SENIOR":
      return buildDynamicSeniorBlock(sheet, sCol, examName, students, mainSubs, skillSubs, config);
    case "SR_SEC_SCIENCE":
      return buildDynamicSrSecScienceBlock(sheet, sCol, examName, students, mainSubs, skillSubs, config);
    case "SR_SEC_ARTS":
      return buildDynamicSrSecArtsBlock(sheet, sCol, examName, students, mainSubs, skillSubs, config);
    default:
      throw new Error(`Unknown engine type: ${engine}`);
  }
}

/**
 * ============================================================================
 * 🔁 TRIGGER SCHEDULER — Recurring Watchdog Pattern
 * ============================================================================
 */
function scheduleNextBatch(jobId, delayMs) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(QUEUE_CONFIG.PROP_ACTIVE_JOB, jobId);

  try {
    const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === QUEUE_CONFIG.TRIGGER_HANDLER);
    if (existing.length > 0) return; // duplicate mat banao

    processExamQueueBatch(); // pehla batch turant

    const stillActive = PropertiesService.getScriptProperties().getProperty(QUEUE_CONFIG.PROP_ACTIVE_JOB);
    if (stillActive) {
      ScriptApp.newTrigger(QUEUE_CONFIG.TRIGGER_HANDLER)
        .timeBased()
        .everyMinutes(1)
        .create();
    }
  } catch (triggerErr) {
    logExamError("SYSTEM", "-", "-", "❌ TRIGGER CREATION FAILED: " + triggerErr.toString());
    throw triggerErr;
  }
}

function deleteTriggersByFunctionName(fnName) {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === fnName) ScriptApp.deleteTrigger(t);
  });
}

/**
 * ============================================================================
 * ✅ JOB FINALIZER — W = sync status, X = error summary
 * ============================================================================
 */
function finalizeExamJob(jobId, meta) {
  const props = PropertiesService.getScriptProperties();

  try {
    const db0 = getDB0();
    const sh = db0.getSheetByName("Master_Config");
    const syncStatus = meta.failed.length === 0 ? "COMPLETED" : "COMPLETED_WITH_ERRORS";

    sh.getRange(meta.ledgerRow, 23).setValue(syncStatus); // W

    if (meta.failed.length > 0) {
      const errorSummary = meta.failed.map(f => `${f.cls}${f.sec}: ${f.error}`).join(" | ").substring(0, 500);
      sh.getRange(meta.ledgerRow, 24).setValue(errorSummary); // X
    }

    if (meta.failed.length === 0) {
      sendPushNotification(
        `Exam "${meta.examName}" Ready`,
        `All ${meta.total} sheet(s) generated successfully.`,
        { type: "EXAM_READY", jobId: jobId, examName: meta.examName }
      );
    } else {
      sendPushNotification(
        `Exam "${meta.examName}" — Partial Failure`,
        `${meta.completed}/${meta.total} sheets built. ${meta.failed.length} failed — check Error Log.`,
        { type: "EXAM_ERROR", jobId: jobId, examName: meta.examName, failed: meta.failed }
      );
    }
  } catch (e) {
    logExamError(meta.examName, "-", "-", "Finalize step failed: " + e.toString());
  } finally {
    props.deleteProperty(QUEUE_CONFIG.PROP_QUEUE_PREFIX + jobId);
    props.deleteProperty(QUEUE_CONFIG.PROP_META_PREFIX + jobId);
    props.deleteProperty(QUEUE_CONFIG.PROP_ACTIVE_JOB);
    deleteTriggersByFunctionName(QUEUE_CONFIG.TRIGGER_HANDLER);
  }
}

/**
 * ============================================================================
 * 📝 ERROR LOGGING
 * ============================================================================
 */
function logExamError(examName, cls, sec, message) {
  try {
    const db0 = getDB0();
    let logSheet = db0.getSheetByName(QUEUE_CONFIG.ERROR_LOG_SHEET);
    if (!logSheet) {
      logSheet = db0.insertSheet(QUEUE_CONFIG.ERROR_LOG_SHEET);
      logSheet.getRange(1, 1, 1, 5).setValues([["Timestamp", "Exam", "Class", "Section", "Error"]]).setFontWeight("bold");
    }
    logSheet.appendRow([new Date(), examName, cls, sec, message]);
  } catch (e) {
    Logger.log(`⚠️ Failed to write Error_Log: ${e.toString()} | Original error: ${message}`);
  }
}

/**
 * ============================================================================
 * 🔔 PUSH NOTIFICATION LAYER
 * ============================================================================
 */
function sendPushNotification(title, body, payload) {
  try {
    const db0 = getDB0();
    let notifySheet = db0.getSheetByName(QUEUE_CONFIG.NOTIFY_SHEET);
    if (!notifySheet) {
      notifySheet = db0.insertSheet(QUEUE_CONFIG.NOTIFY_SHEET);
      notifySheet.getRange(1, 1, 1, 5).setValues([["Timestamp", "Title", "Body", "Payload", "Read"]]).setFontWeight("bold");
    }
    notifySheet.appendRow([new Date(), title, body, JSON.stringify(payload), false]);
  } catch (e) {
    Logger.log("⚠️ Push notification write failed: " + e.toString());
  }
}

/**
 * ============================================================================
 * 📡 NOTIFICATIONS — Toast (unread only) + Landing Feed (recent history)
 * ============================================================================
 */
function getUnreadNotifications() {
  const db0 = getDB0();
  const notifySheet = db0.getSheetByName(QUEUE_CONFIG.NOTIFY_SHEET);
  if (!notifySheet || notifySheet.getLastRow() < 2) return [];

  const data = notifySheet.getRange(2, 1, notifySheet.getLastRow() - 1, 5).getValues();
  const unread = [];
  data.forEach((row, idx) => {
    if (row[4] === false || row[4] === "FALSE" || row[4] === "") {
      unread.push({ row: idx + 2, timestamp: row[0], title: row[1], body: row[2], payload: row[3] });
    }
  });
  return unread;
}

function markNotificationsRead(rowNumbers) {
  const db0 = getDB0();
  const notifySheet = db0.getSheetByName(QUEUE_CONFIG.NOTIFY_SHEET);
  if (!notifySheet) return { status: false };
  rowNumbers.forEach(r => notifySheet.getRange(r, 5).setValue(true));
  return { status: true };
}

function getRecentActivityLog(limit) {
  try {
    const maxItems = Number(limit) || 20;
    const db0 = getDB0();
    const notifySheet = db0.getSheetByName(QUEUE_CONFIG.NOTIFY_SHEET);
    if (!notifySheet || notifySheet.getLastRow() < 2) return { status: true, data: [] };

    const lastRow = notifySheet.getLastRow();
    const startRow = Math.max(2, lastRow - maxItems + 1);
    const numRows = lastRow - startRow + 1;

    const data = notifySheet.getRange(startRow, 1, numRows, 5).getValues();
    const activity = data.map((row, idx) => ({
      row: startRow + idx,
      timestamp: row[0],
      title: row[1],
      body: row[2],
      payload: row[3],
      read: row[4] === true || row[4] === "TRUE"
    })).reverse();

    return { status: true, data: activity };
  } catch (e) {
    return { status: false, message: "Activity Log Error: " + e.toString() };
  }
}

/**
 * ============================================================================
 * 📊 PROGRESS-CHECK API
 * ============================================================================
 */
function getExamJobStatus(jobId) {
  const props = PropertiesService.getScriptProperties();
  const metaRaw = props.getProperty(QUEUE_CONFIG.PROP_META_PREFIX + jobId);
  if (!metaRaw) return { status: false, message: "Job not found (already completed or invalid ID)" };
  return { status: true, data: JSON.parse(metaRaw) };
}

/**
 * ============================================================================
 * 🛠️ DEBUG HELPER
 * ============================================================================
 */
function debugCheckStuckJob() {
  const props = PropertiesService.getScriptProperties();
  const jobId = props.getProperty(QUEUE_CONFIG.PROP_ACTIVE_JOB);
  Logger.log("Active Job ID: " + jobId);

  if (jobId) {
    const queueRaw = props.getProperty(QUEUE_CONFIG.PROP_QUEUE_PREFIX + jobId);
    const metaRaw = props.getProperty(QUEUE_CONFIG.PROP_META_PREFIX + jobId);
    Logger.log("Remaining tasks: " + (queueRaw ? JSON.parse(queueRaw).length : "N/A"));
    Logger.log("Meta: " + metaRaw);
  }

  const triggers = ScriptApp.getProjectTriggers();
  Logger.log("Total project triggers: " + triggers.length);
  triggers.forEach(t => Logger.log(" -> " + t.getHandlerFunction() + " | " + t.getEventType()));
}

/**
 * ============================================================================
 * 3. TOGGLE MATRIX STATUS (CELL UPDATE)
 * ============================================================================
 */
function updateExamControlCell(examName, field, newValue) {
  try {
    const ss = getDB0();
    const sh = ss.getSheetByName("Master_Config");
    const lastRow = sh.getLastRow();

    if (lastRow < 24) return { status: false, message: "No entries found." };

    const names = sh.getRange(24, 17, lastRow - 23, 1).getValues().map(r => String(r[0]).toUpperCase().trim());
    const matchIndex = names.indexOf(String(examName).toUpperCase().trim());

    if (matchIndex === -1) return { status: false, message: "Exam Profile mismatch" };

    const targetRow = 24 + matchIndex;
    let targetCol = 17;

    if (field === "status") targetCol = 19;         // S
    else if (field === "visibility") targetCol = 20; // T
    else if (field === "sync") targetCol = 23;       // W
    else if (field === "error") targetCol = 24;      // X

    sh.getRange(targetRow, targetCol).setValue(String(newValue).toUpperCase().trim());
    return { status: true, message: "Cell Matrix Updated Successfully" };
  } catch (e) {
    return { status: false, message: e.toString() };
  }
}

   // ===========================================
  // 3. DATA FETCHING (READ OPERATIONS) - FIXED
  // ===========================================

  // 3.1--- Student List (For Attendance & View) ---
function fetchStudents(combinedClassString) {
  var sheet = getDB1().getSheetByName("Student_Data");
  var lastRow = sheet.getLastRow();
  if (lastRow < 6) return []; // Safety check

  var data = sheet.getRange(6, 1, lastRow - 5, sheet.getLastColumn()).getValues();
  var list = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    // Row mapping: 0=ID, 1=Roll, 2=Name, 5=Class, 6=Section
    // Combined string match (e.g. "10th - A")
    var currentClassStr = row[5] + " - " + row[6]; 

    if (row[0] !== "" && currentClassStr === combinedClassString) {
      list.push({
        id: row[0],
        roll: row[1],
        name: row[2],
        
        // --- FIX: SEND CLASS & SECTION TO FRONTEND ---
        class: row[5],   // Frontend needs this to send it back
        section: row[6], // Frontend needs this to send it back
        
        father: row[8], 
        photo: row[14]
      });
    }
  }
  // Sort by Roll No
  return list.sort(function(a, b) { return a.roll - b.roll; });
}



// 3.2 --- Student Full Profile (For Detail View) ---
function fetchStudentProfile(id) {
  var sheet = getDB1().getSheetByName("Student_Data");
  var data = sheet.getRange(6, 1, sheet.getLastRow() - 5, sheet.getLastColumn()).getValues();
  
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] == id) {
      var row = data[i];
      // FULL MAPPING
      return {
        id: row[0], roll: row[1], name: row[2], dob: formatDate(row[3]),
        gender: row[4], class: row[5], section: row[6], admDate: formatDate(row[7]),
        father: row[8], mother: row[9], contact: row[10], email: row[11],
        address: row[12], photo: row[14]
        // Password (row 13) intentionally hidden
      };
    }
  }
  return null;
}

// 3,3--- Teacher List (For Attendance & Admin View) ---
/**
 * 3.3 --- Teacher List (Fully Updated) ---
 * Fetches all necessary details for Dashboard, Analytics, and Communication.
 * Uses formatting for dates to ensure international standard display.
 */
function fetchTeachers() {
  var sheet = getDB1().getSheetByName("Teacher_Data");
  var lastRow = sheet.getLastRow();
  
  // Safety check: Agar data nahi hai toh khali list bhejein
  if (lastRow < 6) return []; 

  var data = sheet.getRange(6, 1, lastRow - 5, sheet.getLastColumn()).getValues();
  var list = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    
    // Sirf wahi rows uthayein jahan UID (Col A) maujood ho
    if (row[0] !== "") {
      list.push({
        // --- EXISTING FIELDS (DO NOT DISTURB) ---
        id: row[0],             // Col A: UID
        name: row[1],           // Col B: Name
        designation: row[6],    // Col G: Designation
        mobile: row[11],        // Col L: Mobile No.
        photo: row[15],         // Col P: Photo ID/Link
        
        // --- NEW EXTENDED INFO (EVERY NEEDED INFO) ---
        dob: formatDate(row[2]),         // Col C: Date of Birth
        gender: row[3],                  // Col D: Gender
        father: row[4],                  // Col E: Father/Spouse Name
        mother: row[5],                  // Col F: Mother Name
        subject: row[7],                 // Col H: Main Subject
        qualification: row[8],           // Col I: Qualification
        joinDate: formatDate(row[9]),    // Col J: Joining Date
        salary: row[10],                 // Col K: Monthly Salary
        email: row[12],                  // Col M: Official/Personal Email
        address: row[13]                 // Col N: Residential Address
        // row[14] (Password) is skipped for security
      });
    }
  }
  
  // Alphabetical Order (A-Z) mein list return karega
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

// 3.4--- Class List (Unique "Class - Section" combinations) ---
function fetchClassList() {
  var sheet = getDB1().getSheetByName("Student_Data");
  var data = sheet.getRange(6, 6, sheet.getLastRow() - 5, 2).getValues(); // Col F & G
  var classes = [];
  
  for (var i = 0; i < data.length; i++) {
    var c = data[i][0];
    var s = data[i][1];
    if (c && s) {
      var combo = c + " - " + s;
      if (classes.indexOf(combo) === -1) classes.push(combo);
    }
  }
  return classes.sort();
}

 function sendBrandedEmail(to, subject, type, studentData) {
  const config = getMasterConfig();
  return GmailApp.sendEmail(to, subject, "", {
    from: config.senderEmail, 
    name: config.schoolName,
    htmlBody: studentData 
  });
}



  // ===========================================
  // 4. DATA SAVING (WRITE OPERATIONS) - 
  // ===========================================

  // 4.1 --- Save Student Attendance ---
function saveStudentAttendance(payload) {
  var sheet = getDB1().getSheetByName("Attendance_Logs");
  var timestamp = new Date();
  
  // Valid Status List (Security ke liye)
  var validStatuses = ["P", "A", "L", "OD"]; 

  // Payload check
  if (!payload || payload.length === 0) {
    return { success: false, message: "No Data Received" };
  }

  // Data Mapping: Date, ID, Roll, Name, Class, Section, Status, MarkedBy, Time
  var rows = payload.map(function(r) {
    // Agar status valid list me nahi h, to default 'A' ya error handle karein
    // Yahan hum direct save kar rahe hain par check logic dhyan me rakhein
    
    return [
      r.date, 
      r.id, 
      r.roll, 
      r.name, 
      r.class || "",    
      r.section || "",  
      r.status,         // Yaha 'OD' automatically save ho jayega
      r.markedBy, 
      timestamp
    ];
  });

  if (rows.length > 0) {
    var nextRow = Math.max(sheet.getLastRow() + 1, 6);
    sheet.getRange(nextRow, 1, rows.length, rows[0].length).setValues(rows);
    sendPushNotification(
      "Attendance Marked", 
      `Attendance updated for ${rows.length} students by ${payload[0].markedBy}.`, 
      { type: "ATTENDANCE_SYNC", count: rows.length }
    );
    return { success: true, message: "Attendance (incl. OD) Marked Successfully" };
  }
  return { success: false, message: "Save Failed" };
}

// 4.2--- Save Teacher Attendance ---
function saveTeacherAttendance(payload) {
  var sheet = getDB1().getSheetByName("Teacher_Attendance_Logs");
  var timestamp = new Date();
  
  // Valid Status Check logic (Optional but good for safety)
  // P = Present, A = Absent, L = Leave, OD = On Duty

  // Data: Date, ID, Name, Designation, Status, Time
  var rows = payload.map(r => [
    r.date, 
    r.id, 
    r.name, 
    r.designation, 
    r.status,       // 'OD' support added automatically here
    timestamp
  ]);

  if (rows.length > 0) {
    var nextRow = Math.max(sheet.getLastRow() + 1, 6);
    sheet.getRange(nextRow, 1, rows.length, rows[0].length).setValues(rows);
    sendPushNotification(
      "Staff Attendance Marked", 
      `Staff attendance for ${rows.length} members has been logged.`, 
      { type: "STAFF_ATT_SYNC", count: rows.length }
    );
    

    return { success: true, message: "Staff Attendance Marked" };
  }
  return { success: false, message: "No Data" };
}

// ===========================================
// 5. NEW ADMISSION / HIRING (CREATE OPERATIONS)
// ===========================================

//5.1 --- New Student Admission ---
function addNewStudent(data) {
  var sheet = getDB1().getSheetByName("Student_Data");
  
  // Auto Generate ID: STU + Timestamp (Unique rahega)
  var newID = "STU" + Math.floor(Date.now() / 1000);
  
  // 🔴 NEW: Default password enforce karo agar admin ne khaali chhoda
  if (!data.password || String(data.password).trim() === "") {
    data.password = "Student@123";
  }
  
  // Map data to columns A-O
  var newRow = [
    newID,             // A: ID
    data.roll,         // B
    data.name,         // C
    data.dob,          // D
    data.gender,       // E
    data.classVal,     // F
    data.section,      // G
    new Date(),        // H: Adm Date (Today)
    data.father,       // I
    data.mother,       // J
    data.contact,      // K
    data.email,        // L
    data.address,      // M
    data.password,     // N
    data.photo         // O
  ];
  
  sheet.appendRow(newRow); // Append at bottom
  return { success: true, message: "Student Admitted! ID: " + newID };
}

// 5.2--- New Teacher Hiring ---
function addNewTeacher(data) {
  var sheet = getDB1().getSheetByName("Teacher_Data");
  
  // Auto Generate ID: EMP + Timestamp
  var newID = "EMP" + Math.floor(Date.now() / 1000);
  
  var newRow = [
    newID,             // A
    data.name,         // B
    data.dob,          // C
    data.gender,       // D
    data.fatherSpouse, // E
    data.mother,       // F
    data.designation,  // G
    data.subject,      // H
    data.qualification,// I
    new Date(),        // J: Join Date
    data.salary,       // K
    data.mobile,       // L
    data.email,        // M
    data.address,      // N
    data.password,     // O
    data.photo         // P
  ];
  
  sheet.appendRow(newRow);
  return { success: true, message: "Staff Hired! ID: " + newID };
}


// ============================================================================
// 👤 PROFILE UPDATE ENGINE (Separated from doPost)
// ============================================================================
function updateUserProfile(params) {
  try {
    var email = String(params.email || "").trim().toLowerCase();
    var oldPassInput = String(params.oldPassword || "").trim(); 
    var newPassInput = String(params.newPassword || "").trim(); 
    var photo = params.photo || ""; 
    var source = params.source;
    var userName = params.name || "User";

    if (!email || !source) return { success: false, msg: "Missing essential data!" };

    // --- CASE 1: OLD USERS (DB2 - Exact Match) ---
    if (source === 'OLD_DB') {
      var sheet = getDB2().getSheetByName("Users"); // 🟢 FIXED: Linked to DB2
      if(!sheet) return { success: false, msg: "Users sheet missing in DB2." };
      
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][4]).trim().toLowerCase() === email) { // Email in Col E (Index 4)
          var namingPrefix = data[i][0] + "_" + userName; // UID_Name
          return executeProfileUpdate(sheet, i + 1, 6, 8, namingPrefix, oldPassInput, newPassInput, photo);
        }
      }
    }

    // --- CASE 2: TEACHERS (DB1 - Exact Match) ---
    else if (source === 'NEW_TEACHER') {
      var sheet = getDB1().getSheetByName("Teacher_Data"); // 🟢 Linked to DB1
      var lastRow = sheet.getLastRow();
      if (lastRow < 6) return { success: false, msg: "No records found in Teacher DB." };

      var data = sheet.getRange(6, 1, lastRow - 5, 16).getValues();
      for (var j = 0; j < data.length; j++) {
        if (String(data[j][12]).trim().toLowerCase() === email) { // Email in Col M (Index 12)
          var namingPrefix = data[j][0] + "_" + userName; // UID_Name
          return executeProfileUpdate(sheet, j + 6, 15, 16, namingPrefix, oldPassInput, newPassInput, photo);
        }
      }
    }

    // --- CASE 3: STUDENTS (DB1 - Exact Match) ---
    else if (source === 'NEW_STUDENT') {
      var sheet = getDB1().getSheetByName("Student_Data"); // 🟢 Linked to DB1
      var lastRow = sheet.getLastRow();
      if (lastRow < 6) return { success: false, msg: "No records found in Student DB." };

      var data = sheet.getRange(6, 1, lastRow - 5, 15).getValues();
      for (var k = 0; k < data.length; k++) {
        if (String(data[k][11]).trim().toLowerCase() === email) { // Email in Col L (Index 11)
          var namingPrefix = data[k][0] + "_" + userName; // 🟢 FIXED: Used UID instead of Roll No for safety
          return executeProfileUpdate(sheet, k + 6, 14, 15, namingPrefix, oldPassInput, newPassInput, photo);
        }
      }
    }

    return { success: false, msg: "User email not found in the database." };

  } catch (e) {
    return { success: false, msg: "Engine Error: " + e.toString() };
  }
}

// ============================================================================
// ⚙️ HELPER: EXECUTE SHEET UPDATE
// ============================================================================
function executeProfileUpdate(sheet, row, passCol, photoCol, namingPrefix, oldPassInput, newPassInput, photo) {
  var currentPassInSheet = String(sheet.getRange(row, passCol).getValue()).trim();
  
  // A. PASSWORD LOGIC
  if (newPassInput !== "") {
    if (currentPassInSheet !== oldPassInput) {
      return { success: false, msg: "Incorrect Old Password!" };
    }
    sheet.getRange(row, passCol).setValue(newPassInput);
  }

  // B. PHOTO & GOOGLE DRIVE LOGIC
  if (photo !== "" && photo.startsWith("data:image")) {
    var oldPhotoVal = sheet.getRange(row, photoCol).getValue();
    var finalPhotoVal = handleImageUpdate(photo, oldPhotoVal, namingPrefix);
    sheet.getRange(row, photoCol).setValue(finalPhotoVal); // ID ya Base64 save karega
  } else if (photo !== "") {
    sheet.getRange(row, photoCol).setValue(photo); // Direct URL upload fallback
  }

  return { success: true, msg: "Profile Updated Successfully!" };
}

// ============================================================================
// 📁 HELPER: GOOGLE DRIVE IMAGE HANDLER (Optimized & Failsafe)
// ============================================================================
function handleImageUpdate(newBase64, oldCellValue, fileName) {
  var folderId = getMasterConfig().folderProfiles;
  
  // 1. DELETE OLD FILE FROM DRIVE
  if (oldCellValue && oldCellValue.length < 100 && oldCellValue.indexOf("data:") === -1) {
    try { DriveApp.getFileById(oldCellValue).setTrashed(true); } 
    catch (e) { Logger.log("Old file not found/trashed: " + e.message); }
  }

  // 2. UPLOAD NEW FILE TO DRIVE
  try {
    var folder = DriveApp.getFolderById(folderId);
    
    // Extension Fix
    var mimeType = newBase64.substring(5, newBase64.indexOf(';')); // e.g., image/jpeg
    var extension = mimeType.split('/')[1] || "jpg"; 
    
    var bytes = Utilities.base64Decode(newBase64.split(',')[1]);
    var blob = Utilities.newBlob(bytes, mimeType, fileName + "." + extension);
    
    var newFile = folder.createFile(blob);
    
    // 🟢 FIXED: Sharing blocked bypass
    try {
        newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(shareErr) {
        Logger.log("Sharing denied by Workspace Admin, but image is saved.");
    }
    
    return newFile.getId(); // Return Drive ID to save in Google Sheet
    
  } catch (err) {
    Logger.log("Drive Upload Failed: " + err.message);
    // Fallback: Agar Drive full ho ya ID galat ho, toh Base64 text direct sheet mein save kar dega
    return newBase64; 
  }
}

// ============================================================================
// 🛠️ UNIVERSAL INDIVIDUAL PROFILE UPDATE ENGINE (STUDENT & TEACHER)
// ============================================================================
function updateUniversalProfileComplete(params) {
  try {
    var source = params.source; // 'NEW_STUDENT' or 'NEW_TEACHER'
    var updaterRole = String(params.updaterRole || "").toUpperCase().trim(); // 'ADMIN' or 'STUDENT'
    var targetUid = String(params.uid || "").trim();
    var targetRoll = String(params.roll || "").trim(); // Only for students
    var oldPassInput = String(params.oldPassword || "").trim();

    if (!source || !targetUid) return { success: false, msg: "UID and Source are mandatory!" };

    var ss = getDB1(); // 🟢 Strictly running on New DB1 Sheet

    // ========================================================================
    // 📂 CASE 1: STUDENT DATA UPDATE (DB1 -> Student_Data)
    // ========================================================================
    if (source === "NEW_STUDENT") {
      var sheet = ss.getSheetByName("Student_Data");
      if (!sheet) return { success: false, msg: "Student_Data sheet not found in DB1!" };

      var lastRow = sheet.getLastRow();
      if (lastRow < 6) return { success: false, msg: "No student records available." };

      // 🟢 STRICT TEXT READ: Prevents time-zone corruption on DOB/Dates
      var range = sheet.getRange(6, 1, lastRow - 5, 15);
      var data = range.getDisplayValues(); 
      var foundRowIndex = -1;

      // Match using BOTH UID (Col A) and Roll No (Col B)
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === targetUid && String(data[i][1]).trim() === targetRoll) {
          foundRowIndex = i + 6; // Actual row number in sheet
          break;
        }
      }

      if (foundRowIndex === -1) return { success: false, msg: "Student with matching UID and Roll No not found!" };

      // Get current row values for in-memory modification
      var rowRange = sheet.getRange(foundRowIndex, 1, 1, 15);
      var rowVals = rowRange.getValues()[0];

      // 🔒 SECURITY CHECK: If non-admin changes, verify password
      if (updaterRole !== "ADMIN") {
        var currentPass = String(rowVals[13]).trim(); // Col N is Password
        if (currentPass !== oldPassInput) return { success: false, msg: "Security Alert: Incorrect Old Password!" };
      }

      // 🟢 IN-MEMORY BATCH MAPPING (Updates only passed fields, retains unchanged ones)
      if (params.name !== undefined)     rowVals[2]  = String(params.name).trim();
      if (params.dob !== undefined)      rowVals[3]  = String(params.dob).trim();
      if (params.gender !== undefined)   rowVals[4]  = String(params.gender).trim();
      if (params.classVal !== undefined) rowVals[5]  = String(params.classVal).trim();
      if (params.section !== undefined)  rowVals[6]  = String(params.section).trim();
      if (params.father !== undefined)   rowVals[8]  = String(params.father).trim();
      if (params.mother !== undefined)   rowVals[9]  = String(params.mother).trim();
      if (params.mobile !== undefined)   rowVals[10] = String(params.mobile).trim();
      if (params.email !== undefined)    rowVals[11] = String(params.email).trim().toLowerCase();
      if (params.address !== undefined)  rowVals[12] = String(params.address).trim();
      if (params.newPassword && params.newPassword.trim() !== "") rowVals[13] = String(params.newPassword).trim();

      // Image Upload Processing
      if (params.photo && params.photo.startsWith("data:image")) {
        var oldPhoto = rowVals[14];
        rowVals[14] = handleImageUpdate(params.photo, oldPhoto, targetUid + "_" + (params.name || "Student"));
      }

      // 🚀 SINGLE-SHOT BULK WRITE: Extremely fast row write
      rowRange.setValues([rowVals]);

      
      return { success: true, msg: "Student Profile Updated Successfully!" };
    }

    // ========================================================================
    // 📂 CASE 2: TEACHER DATA UPDATE (DB1 -> Teacher_Data)
    // ========================================================================
    else if (source === "NEW_TEACHER") {
      var sheet = ss.getSheetByName("Teacher_Data");
      if (!sheet) return { success: false, msg: "Teacher_Data sheet not found in DB1!" };

      var lastRow = sheet.getLastRow();
      if (lastRow < 6) return { success: false, msg: "No teacher records available." };

      var range = sheet.getRange(6, 1, lastRow - 5, 16);
      var data = range.getDisplayValues();
      var foundRowIndex = -1;

      // Teachers are matched purely by UID (Col A)
      for (var j = 0; j < data.length; j++) {
        if (String(data[j][0]).trim() === targetUid) {
          foundRowIndex = j + 6;
          break;
        }
      }

      if (foundRowIndex === -1) return { success: false, msg: "Teacher profile not found!" };

      var rowRange = sheet.getRange(foundRowIndex, 1, 1, 16);
      var rowVals = rowRange.getValues()[0];

      // 🔒 SECURITY CHECK: If non-admin changes, verify password
      if (updaterRole !== "ADMIN") {
        var currentPass = String(rowVals[14]).trim(); // Col O is Password
        if (currentPass !== oldPassInput) return { success: false, msg: "Security Alert: Incorrect Old Password!" };
      }

      // 🟢 IN-MEMORY BATCH MAPPING FOR TEACHERS
      if (params.name !== undefined)          rowVals[1]  = String(params.name).trim();
      if (params.dob !== undefined)           rowVals[2]  = String(params.dob).trim();
      if (params.gender !== undefined)        rowVals[3]  = String(params.gender).trim();
      if (params.father !== undefined)        rowVals[4]  = String(params.father).trim();
      if (params.mother !== undefined)        rowVals[5]  = String(params.mother).trim();
      if (params.designation !== undefined)   rowVals[6]  = String(params.designation).trim();
      if (params.subject !== undefined)       rowVals[7]  = String(params.subject).trim();
      if (params.qualification !== undefined) rowVals[8]  = String(params.qualification).trim();
      if (params.salary !== undefined)        rowVals[10] = String(params.salary).trim();
      if (params.mobile !== undefined)        rowVals[11] = String(params.mobile).trim();
      if (params.email !== undefined)         rowVals[12] = String(params.email).trim().toLowerCase();
      if (params.address !== undefined)       rowVals[13] = String(params.address).trim();
      if (params.newPassword && params.newPassword.trim() !== "") rowVals[14] = String(params.newPassword).trim();

      // Image Upload Processing
      if (params.photo && params.photo.startsWith("data:image")) {
        var oldPhoto = rowVals[15];
        rowVals[15] = handleImageUpdate(params.photo, oldPhoto, targetUid + "_" + (params.name || "Teacher"));
      }

      // 🚀 SINGLE-SHOT BULK WRITE
      rowRange.setValues([rowVals]);
      return { success: true, msg: "Teacher Profile Updated Successfully!" };
    }

    return { success: false, msg: "Invalid update source database provided." };

  } catch (e) {
    return { success: false, msg: "Engine Error: " + e.toString() };
  }
}
// ============================================================================
// EXTRACT FULL STUDENT DATA BATCH (STRICT TEXT READ FOR ID CARDS)
// ============================================================================
function getFullStudentBatch(classVal, sectionVal) {
  try {
    var ss = getDB1();
    var sheet = ss.getSheetByName("Student_Data");
    
    if (!sheet) return { status: false, message: "Student_Data sheet missing in DB1" };

    var lastRow = sheet.getLastRow();
    if (lastRow < 6) return { status: true, data: [] };

    // 🟢 STRICT FORMAT RULE APPLIED: getDisplayValues() used instead of getValues()
    // Ye ensure karega ki Date aur Number exact text format me aayenge
    var data = sheet.getRange(6, 1, lastRow - 5, 15).getDisplayValues();
    var results = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var rowClass = String(row[5]).trim(); // Col F
      var rowSec = String(row[6]).trim();   // Col G

      if (rowClass === String(classVal).trim() && rowSec === String(sectionVal).trim()) {
        results.push({
          uid: String(row[0]).trim(),
          roll: String(row[1]).trim(),
          name: String(row[2]).trim(),
          dob: String(row[3]).trim(),
          gender: String(row[4]).trim(),
          father: String(row[8]).trim(),
          mother: String(row[9]).trim(),
          mobile: String(row[10]).trim(),
          email: String(row[11]).trim(),
          address: String(row[12]).trim(),
          photo: String(row[14]).trim()
        });
      }
    }

    return { status: true, data: results };

  } catch (e) {
    return { status: false, message: "Engine Error: " + e.toString() };
  }
}

//5.3---Attendance data---------------
/**
 * MASTER ATTENDANCE LOGIC (UNIFIED)
 * Filters: date (required), classVal, section, uid, reportType (DAILY/MONTHLY)
 */
function masterAttendanceLogic(params) {
  const ss = getDB1();
  const dateObj = new Date(params.date);
  const dayNum = dateObj.getDate();
  const monthIdx = dateObj.getMonth();
  const fullYear = dateObj.getFullYear();
  const shortYear = String(fullYear).slice(-2);
  
  const reportType = params.reportType || "DAILY"; // "DAILY" or "MONTHLY"
  const START_COL = 4;
  const BLOCK_W = 38;

  // 1. DYNAMIC SHEET SELECTION (Filter Level: School -> Class -> Section)
  let sheetsToScan = [];
  let allSheets = ss.getSheets();
  let suffix = "-" + shortYear;

  allSheets.forEach(sh => {
    let name = sh.getName();
    // Filter by Year
    if (name.endsWith(suffix) || name.includes("Staff_Register_" + fullYear)) {
      let match = true;
      // Filter by Class (e.g., "6")
      if (params.classVal && !name.startsWith(params.classVal)) match = false;
      // Filter by Section (e.g., "A")
      if (params.section && !name.includes(params.section)) match = false;
      
      if (match) sheetsToScan.push(sh);
    }
  });

  let responseData = {
    summary: { P: 0, A: 0, L: 0, OD: 0, total: 0 },
    list: [],
    individualChart: null
  };

  // 2. DATA EXTRACTION
  const statsStartColIdx = (START_COL + (monthIdx * BLOCK_W) + 31) - 1; // 0-indexed column for 'P'
  const dailyColIdx = (START_COL + (monthIdx * BLOCK_W) + dayNum - 1) - 1;

  sheetsToScan.forEach(sheet => {
    let lastR = sheet.getLastRow();
    if (lastR < 6) return;
    let data = sheet.getRange(6, 1, lastR - 10, sheet.getLastColumn()).getValues();

    data.forEach(row => {
      // UID Filter (Specific Student)
      if (params.uid && String(row[0]) !== String(params.uid)) return;

      let p = row[statsStartColIdx] || 0;
      let a = row[statsStartColIdx + 1] || 0;
      let l = row[statsStartColIdx + 2] || 0;
      let od = row[statsStartColIdx + 3] || 0;
      let perc = (parseFloat(row[statsStartColIdx + 4]) * 100).toFixed(1);

      // Agar Daily report hai to status check karein
      let status = String(row[dailyColIdx] || "").trim().toUpperCase();

      // Individual Chart Data (If UID provided)
      if (params.uid) {
        responseData.individualChart = calculateYearlyForStudent(row, START_COL, BLOCK_W);
      }

      // Add to List
      responseData.list.push({
        uid: row[0],
        roll: row[1],
        name: row[2],
        class: sheet.getName().split("-")[0],
        status: status,
        monthlyP: p,
        monthlyA: a,
        percentage: perc + "%"
      });

      // Aggregate Summary (Only if not single student)
      if (reportType === "DAILY") {
        if (status === "P") responseData.summary.P++;
        else if (status === "A") responseData.summary.A++;
        else if (status === "L") responseData.summary.L++;
        else if (status === "OD") responseData.summary.OD++;
      } else {
        responseData.summary.P += p;
        responseData.summary.A += a;
      }
    });
  });

  responseData.summary.total = responseData.list.length;
  return responseData;
}


// =========================================================================
// 🚀 TIER 1: GET DAILY LOG (Flat Data Fetch for Zero-Latency Frontend)
// =========================================================================
function getDailyAttendanceSummary(targetDateStr) {
  try {
    var ss = getDB1();
    var sheet = ss.getSheetByName("Attendance_Logs");
    
    if (!sheet) return { status: false, message: "Attendance_Logs sheet not found." };
    
    var lastRow = sheet.getLastRow();
    if(lastRow < 2) return { status: true, data: [] };
    
    // Sirf starting ke 7 columns read karenge speed badhane ke liye
    // Cols: Date(A), UID(B), Roll(C), Name(D), Class(E), Section(F), Status(G)
    var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues(); 
    
    var targetDate = new Date(targetDateStr).toDateString();
    var results = [];
    
    // Single Loop: Sirf requested date ka data uthayega
    for (var i = 0; i < data.length; i++) {
      if(!data[i][0]) continue; // Skip empty rows
      
      var rowDate = new Date(data[i][0]).toDateString();
      if (rowDate === targetDate) {
        results.push({
          uid: data[i][1],
          roll: data[i][2],
          name: data[i][3],
          classVal: data[i][4],
          section: data[i][5],
          status: String(data[i][6]).trim().toUpperCase() // P, A, L, OD
        });
      }
    }
    
    // Frontend ko ek flat array bhejenge, JS aage khud usko classes me filter kar lega
    return { status: true, data: results };
  } catch (e) {
    return { status: false, message: e.toString() };
  }
}

// =========================================================================
// ⚡ TIER 3: GET STUDENT MONTHLY HISTORY (Using TextFinder & Deep Math)
// =========================================================================
function getStudentMonthlyHistory(uid, classVal, section) {
  try {
    var ss = getDB1();
    var config = getMasterConfig();
    
    // 1. Dynamic Tab Name Generation (e.g., "10A-26")
    var yearStr = String(config.currentSession || new Date().getFullYear()).slice(-2);
    var sheetName = String(classVal).trim() + String(section).trim() + "-" + yearStr;
    
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { status: false, message: "Register not generated for " + sheetName };
    
    // 2. 🎯 X-RAY SEARCH: Poori sheet padhne ke bajaye TextFinder se direct bachhe par koodo
    var textFinder = sheet.createTextFinder(String(uid)).matchEntireCell(true);
    var match = textFinder.findNext();
    
    if (!match) return { status: false, message: "Student UID not found in class register." };
    
    // 3. ISOLATE ROW: Sirf usi bachhe ki ek row memory mein laye (Fastest!)
    var rowNum = match.getRow();
    var maxCols = sheet.getLastColumn();
    var rowData = sheet.getRange(rowNum, 1, 1, maxCols).getValues()[0];
    
    // 4. 🧮 DEEP MICRO-LEVEL MATH INDEXING 
    // Arrays 0-indexed hote hain. 
    // Start Col D = Index 3. 
    // Har mahine ka block 38 columns ka hai (31 days + 5 stats + 2 gap).
    // Month 'm' ke liye (m=0 to 11), 'P' stat ka index hoga: 3 + (m*38) + 31 = 34 + (m*38).
    
    var months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    var history = [];
    
    var currentMonthIdx = new Date().getMonth(); // Sirf current mahine tak calculate karega
    
    for (var m = 0; m <= currentMonthIdx; m++) {
      var pIdx   = 34 + (m * 38);
      var aIdx   = 35 + (m * 38);
      var lIdx   = 36 + (m * 38);
      var odIdx  = 37 + (m * 38);
      var pctIdx = 38 + (m * 38);
      
      // Safety bound check
      if (pctIdx < rowData.length) {
        var pCount  = Number(rowData[pIdx]) || 0;
        var aCount  = Number(rowData[aIdx]) || 0;
        var lCount  = Number(rowData[lIdx]) || 0;
        var odCount = Number(rowData[odIdx]) || 0;
        
        var pctVal = rowData[pctIdx];
        var displayPct = (!isNaN(pctVal) && pctVal !== "") ? Math.round(pctVal * 100) : 0;
        
        // Sirf wo month bhejo jisme uski kam se kam 1 attendance lagi ho
        if (pCount > 0 || aCount > 0 || lCount > 0 || odCount > 0) {
            history.push({
              month: months[m],
              P: pCount,
              A: aCount,
              L: lCount,
              OD: odCount,
              pct: displayPct
            });
        }
      }
    }
    
    return {
      status: true,
      data: {
        uid: uid,
        name: rowData[2], // Name is in Col C (Index 2)
        history: history
      }
    };
    
  } catch (e) {
    return { status: false, message: e.toString() };
  }
}

/** * Helper: Student ka 12 month ka data ek sath nikalne ke liye
 */
function calculateYearlyForStudent(row, START_COL, BLOCK_W) {
  let yearly = [];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let m = 0; m < 12; m++) {
    let idx = (START_COL + (m * BLOCK_W) + 31) - 1;
    yearly.push({ month: months[m], p: row[idx], a: row[idx+1], perc: (parseFloat(row[idx+4])*100).toFixed(0) });
  }
  return yearly;
}

// ===========================================
// 6. HELPER UTILITIES
// ===========================================
function formatDate(dateObj) {
  if (!dateObj) return "";
  return Utilities.formatDate(new Date(dateObj), Session.getScriptTimeZone(), "dd/MM/yyyy");
}



  


/**=================================================================================================
 * SHEET 2 FUNCTIONS LINKED TO TEST DATA BASE USERS RESPONSES , PLANNER, NOTICES ETC........ 
 * ================================================================================================*/



// ==========================================
// 1.HELPER: Standard JSON Response
// ==========================================
function sendJSON(status, message, data) {
  var result = JSON.stringify({
    "status": status,
    "message": message,
    "data": data || null
  });
  return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 🌐 MASTER doGet ROUTER
 * Handles both:
 * 1. WhatsApp Webhook Verification (Meta)
 * 2. Admin Portal UI (Browser)
 */
function doGet(e) {
  
  // 🟢 CASE 1: WHATSAPP VERIFICATION (Meta Request)
  // Meta hamesha 'hub.mode=subscribe' bhejta hai verify karte waqt
  if (e.parameter['hub.mode'] == 'subscribe') {
    
    var myVerifyToken = "CK_ADMIN_SECRET_123"; // Jo hum Meta console me dalenge
    var sentToken = e.parameter['hub.verify_token'];
    var challenge = e.parameter['hub.challenge'];
    
    // Token Match Check
    if (sentToken === myVerifyToken) {
      // Agar password sahi hai, to challenge code wapas bhejo (Plain Text)
      return ContentService.createTextOutput(challenge);
    } else {
      // Agar galat hai, error do
      return ContentService.createTextOutput("❌ Access Denied: Wrong Verification Token");
    }
  }

  // 🟢 CASE 2: NORMAL USER / ADMIN (Your Old Code)
  // Agar upar wala 'if' nahi chala, iska matlab koi insaan aaya hai browser se
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Master Result Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


// ==========================================
// 9. Question admin dasboard 
//============================================

function getDatabaseDump(params) {
  params = params || {}; // Safety fallback
  var ss = getDB2(); // Connect to Sheet 2
  var result = {};

  try {
    // 1. USERS SHEET
    var userSheet = ss.getSheetByName("Users");
    if (userSheet) {
      var uData = userSheet.getDataRange().getValues();
      var users = [];
      for (var i = 1; i < uData.length; i++) {
        // Ensure we handle potential undefined values
        users.push({
          uid: String(uData[i][0] || ""), 
          name: String(uData[i][1] || ""), 
          father: String(uData[i][2] || ""), 
          mobile: String(uData[i][3] || ""), 
          email: String(uData[i][4] || ""),
          photo: String(uData[i][7] || ""), 
          address: String(uData[i][9] || "")
        });
      }
      result.users = users;
    }

    // 2. RESPONSES SHEET
    
    var respSheet = ss.getSheetByName("Responses");
    if (respSheet) {
      // 🔴 NEW MICRO-FIX: Read registry directly to attach visibility to responses
      var registryList = [];
      try { registryList = readTestRegistry(); } catch(e) {}
      var regByTest = {};
      registryList.forEach(function(r) { regByTest[r.testId] = r; });

      var rData = respSheet.getDataRange().getValues();
      var responses = [];
      for (var j = 1; j < rData.length; j++) {
        var tId = String(rData[j][16] || "").trim(); // Column Q (Test ID)
        
        // Find visibility from registry (Default to IMMEDIATE)
        var reg = regByTest[tId];
        var visStatus = reg ? reg.resultVisibility : "IMMEDIATE";

        responses.push({
          uid: String(rData[j][0] || ""),              
          name: String(rData[j][1] || ""),              
          testName: String(rData[j][4] || ""),          
          timestamp: rData[j][5],         
          totalQ: rData[j][6],            
          correct: rData[j][7],            
          score: rData[j][10],            
          timeTaken: rData[j][14],        
          testId: tId,    
          userChoices: rData[j][17],                    
          timeSpent: rData[j][19] || "[]",              
          proctorUrl: rData[j][20] || "",
          visibility: visStatus  // 🔴 NEW: Direct visibility attachment
        });
      }
      result.responses = responses;
    }

    // 3. QUESTION BANK SHEET
    var qSheet = ss.getSheetByName("QuestionBank");
    if (qSheet) {
      var qData = qSheet.getDataRange().getValues();
      var uniqueTests = {};
      var allQuestions = [];

      for (var k = 1; k < qData.length; k++) {
        var tId = String(qData[k][0] || "").trim(); // Column A (Test ID)

        // Skip empty rows
        if (!tId) continue;

        // Build Library Menu
        if (!uniqueTests[tId]) {
          uniqueTests[tId] = {
            testId: tId, 
            class: String(qData[k][1] || ""),
            subject: String(qData[k][2] || ""),
            chapter: String(qData[k][4] || ""),
            testName: String(qData[k][5] || ""),
            time: qData[k][6]
          };
        }

        // --- ROBUST OPTION READING ---
        var opts = {};
        if(qData[k][9])  opts["A"] = String(qData[k][9]);
        if(qData[k][10]) opts["B"] = String(qData[k][10]);
        if(qData[k][11]) opts["C"] = String(qData[k][11]);
        if(qData[k][12]) opts["D"] = String(qData[k][12]);

        // --- ENSURE TEXT IS NEVER UNDEFINED ---
        var qText = (qData[k][8] === undefined || qData[k][8] === "") ? "Question Text Missing in Sheet" : String(qData[k][8]);

        allQuestions.push({
          testId: tId,                    
          chapterName: String(qData[k][4] || ""),       
          qId: String(qData[k][7] || ""),               // Column H
          text: qText,                                  // Column I
          options: opts,                  
          correct: String(qData[k][13] || "").trim(),   // Column N
          explanation: String(qData[k][14] || "")       // Column O
        });
      }

      var menuList = [];
      for (var key in uniqueTests) { menuList.push(uniqueTests[key]); }

           // =========================================================
      // 🔴 NEW: TEST REGISTRY FILTER & SECURITY GATEKEEPER
      // =========================================================
      try {
        var registryList = readTestRegistry();
        var regByTest = {};
        registryList.forEach(function(r) { regByTest[r.testId] = r; });

        var isAdmin = String(params.verifiedRole || "").toUpperCase() === "ADMIN" || String(params.verifiedRole || "").toUpperCase() === "TEACHER";
        var allowedTestIds = {};
        var filteredTests = [];

        for (var idx = 0; idx < menuList.length; idx++) {
          var t = menuList[idx];
          var reg = regByTest[t.testId];
          
          // Inject Registry Meta Data
          t.status = reg ? reg.status : "DRAFT";
          t.regClass = reg ? reg.classVal : t.class;
          t.regSection = reg ? reg.section : "ALL";
          t.resultVisibility = reg ? reg.resultVisibility : "IMMEDIATE";
          t.visibleTo = reg ? reg.visibleTo : ""; // 🟢 Fetch Access String

          if (isAdmin) {
            // Admin/Teacher sees EVERYTHING
            filteredTests.push(t);
            allowedTestIds[t.testId] = true;
          } else {
            // Student Filtering: Must be PUBLISHED
            if (t.status === "PUBLISHED") {
               if (params.studentClass) {
                // 🟢 SMART MATCH: Remove the word "CLASS " so "CLASS 10" becomes "10"
                var stuClassStr = String(params.studentClass).toUpperCase().replace(/CLASS\s*/g, '').trim();
                var accessStr = t.visibleTo ? String(t.visibleTo).toUpperCase().replace(/CLASS\s*/g, '').trim() : String(t.regClass).toUpperCase().replace(/CLASS\s*/g, '').trim();
                var classMatch = false;
                
                if (accessStr === "ALL" || accessStr === "GENERAL" || accessStr === "") {
                  classMatch = true;
                } else {
                  // e.g., "9, 10" -> ["9", "10"]
                  var allowedClasses = accessStr.split(',').map(function(c) { return c.trim(); });
                  if (allowedClasses.indexOf(stuClassStr) !== -1) {
                    classMatch = true;
                  }
                }

                var secMatch = (t.regSection === "ALL") || (String(t.regSection).toUpperCase() === String(params.studentSection || "").toUpperCase());
                
                if (classMatch && secMatch) {
                  filteredTests.push(t);
                  allowedTestIds[t.testId] = true;
                }
              }
                else {
                // If no class parameter is passed (Legacy fallback), show all published
                filteredTests.push(t);
                allowedTestIds[t.testId] = true;
              }
            }
          }
        }

        result.tests = filteredTests;

        // 🟢 SECURITY: Filter Questions - Only send questions for allowed tests
        if (result.questionBank) {
          var secureQuestions = [];
          for (var q = 0; q < allQuestions.length; q++) {
            if (allowedTestIds[allQuestions[q].testId]) {
              secureQuestions.push(allQuestions[q]);
            }
          }
          result.questionBank = secureQuestions;
        }

      } catch (e) {
        Logger.log("Dump filter error: " + e.toString());
        // Fallback in case of registry read error
        result.tests = menuList; 
        if (typeof allQuestions !== 'undefined') result.questionBank = allQuestions; 
      }
      // =========================================================
    }

    return result;

  } catch (err) {
    return { error: true, message: "Server Error: " + err.toString() };
  }
}


// ==========================================
// HELPER: Get Student History (Missing Fix)
// ==========================================
function getStudentSubjectHistory(uid, subject) {
  var ss = getDB2();
  var sheet = ss.getSheetByName("Responses");
  if (!sheet) return { status: false, message: "Responses sheet missing" };

  var data = sheet.getDataRange().getValues();
  var history = [];

  for (var i = 1; i < data.length; i++) {
    // Col A is UID (Index 0)
    if (String(data[i][0]) == uid) {
      history.push({
        testName: data[i][4],
        score: data[i][10],
        date: data[i][5],
        correct: data[i][7],
        incorrect: data[i][8]
      });
    }
  }
  return { status: true, data: history };
}

/**
 * 🛰️ DIRECTORY ENGINE: Normalizes data from different sheets
 * Source SCHOOL: Scans DB1 (Student_Data) with Filters
 * Source USERS: Scans DB2 (Users) - Complete List
 */
function fetchStandardizedDirectory(params) {
  var source = params.source || "SCHOOL";
  var results = [];
  
  try {
    if (source === "SCHOOL") {
      // --- DATABASE 1: SCHOOL DATA ---
      var ss = getDB1();
      var sheet = ss.getSheetByName("Student_Data");
      if (!sheet) return { status: false, message: "School Sheet Missing" };

      var lastRow = sheet.getLastRow();
      if (lastRow < 6) return { status: true, data: [] };

      // Optimized Fetch: Row 6 se poora data
      var data = sheet.getRange(6, 1, lastRow - 5, sheet.getLastColumn()).getValues();
      
      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        // Filtering: Class (Index 5) and Section (Index 6)
        // Match string comparison to handle both numbers and text
        if (String(row[5]) == String(params.classVal) && String(row[6]) == String(params.section)) {
          results.push({
            uid: String(row[0]),       // Col A: ID
            name: String(row[2]),      // Col C: Name
            father: String(row[8]),    // Col I: Father
            mobile: String(row[10]),   // Col K: Mobile
            email: String(row[11]),    // Col L: Email
            address: String(row[12]),  // Col M: Address
            photo: row[14],            // Col O: Raw Photo (ID/Base64) - For Utils.getAvatar
            isVerified: true           // Blue Badge trigger
          });
        }
      }
    } else {
      // --- DATABASE 2: PORTAL USERS ---
      var ss = getDB2();
      var sheet = ss.getSheetByName("Users");
      if (!sheet) return { status: false, message: "Users Sheet Missing" };

      var data = sheet.getDataRange().getValues();
      
      for (var j = 1; j < data.length; j++) { // Skip header
        var uRow = data[j];
        results.push({
          uid: String(uRow[0]),      // Col A: UID
          name: String(uRow[1]),     // Col B: Name
          father: String(uRow[2]),   // Col C: Father
          mobile: String(uRow[3]),   // Col D: Mobile
          email: String(uRow[4]),    // Col E: Email
          photo: uRow[7],            // Col H: Photo (Index 7) - For Utils.getAvatar
          address: String(uRow[9]),  // Col J: Address (Index 9)
          isVerified: false
        });
      }
    }

    // Final Sort by Name (A-Z)
    results.sort((a, b) => a.name.localeCompare(b.name));

    return { status: true, data: results };

  } catch (e) {
    return { status: false, message: "Engine Error: " + e.toString() };
  }
}


  // ============================================================================
 // 📁 DEDICATED FUNCTION 1: SYLLABUS UPLOAD ENGINE (WITH SAFETY CHECK)
 // ============================================================================
function handleSyllabusUpload(params, ss) {
  var driveLink = "";
  
  if (params.fileData) {
    try {
      var config = getMasterConfig();
      // Master Config (DB0) se strictly folderSyllabus ki ID uthayega
      var folder = DriveApp.getFolderById(config.folderSyllabus); 
      
      var blob = Utilities.newBlob(Utilities.base64Decode(params.fileData), params.mimeType, params.fileName);
      var file = folder.createFile(blob);
      
      // 🟢 Workspace Permission Security Bypass
      try {
         file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch(shareError) {
         Logger.log("Syllabus sharing restricted by Workspace Admin, file saved privately.");
      }
      
      driveLink = file.getUrl();
    } catch(e) { 
      return sendJSON(false, "Drive App Access Denied (Syllabus Folder): " + e.toString()); 
    }
  }
  
  // =========================================================================
  // 🛡️ SAFETY CHECK: Clean & Standardize Class Input (e.g., "10" -> "Class 10")
  // =========================================================================
  var sanitizedClass = "N/A";
  if (params.class) {
    var rawClass = String(params.class).trim();
    // Agar input sirf ek pure number hai (jaise "10"), toh aage "Class " jod do
    if (/^\d+$/.test(rawClass)) {
      sanitizedClass = "Class " + rawClass;
    } else {
      // Agar pehle se "Class 10" ya "10th" likha hai, toh bina chede waisa hi rakhein
      sanitizedClass = rawClass;
    }
  }
  
  // DB2 ki Syllabus sheet mein logging
  try {
    var newDocId = "DOC-" + Math.floor(Math.random() * 90000);
    // params.class ki jagah ab sanitizedClass save hoga (Column B)
    ss.getSheetByName("Syllabus").appendRow([newDocId, sanitizedClass, params.subject, params.title, driveLink, new Date()]);
    return sendJSON(true, "Syllabus Uploaded Successfully");
  } catch(sheetError) {
    return sendJSON(false, "Syllabus Sheet Log Error: " + sheetError.toString());
  }
}

// ============================================================================
// 📁 DEDICATED FUNCTION 2: NOTICES UPLOAD ENGINE
// ============================================================================
function handleNoticeUpload(params, ss) {
  var driveLink = "";
  
  if (params.fileData) {
    try {
      var config = getMasterConfig();
      // Notices ke attachments ko strictly folderProfiles (ya notice space) me daalega
      var folder = DriveApp.getFolderById(config.folderProfiles); 
      
      var blob = Utilities.newBlob(Utilities.base64Decode(params.fileData), params.mimeType, params.fileName);
      var file = folder.createFile(blob);
      
      // 🟢 Workspace Permission Security Bypass
      try {
         file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch(shareError) {
         Logger.log("Notice sharing restricted by Workspace Admin, file saved privately.");
      }
      
      driveLink = file.getUrl();
    } catch(e) { 
      return sendJSON(false, "Drive App Access Denied (Notices/Profiles Folder): " + e.toString()); 
    }
  }
  
  // DB2 ki Notices sheet mein logging
  try {
    var newNotId = "NOT-" + Math.floor(Math.random() * 90000);
    ss.getSheetByName("Notices").appendRow([newNotId, params.title, params.message, new Date(), driveLink, params.type || "Info"]);
    return sendJSON(true, "Notice Broadcasted Successfully");
  } catch(sheetError) {
    return sendJSON(false, "Notice Sheet Log Error: " + sheetError.toString());
  }
}

/**===========================================================================================
 * SHEET 3 DB3 RESULT DATA  FUNCTIONS -----------------------------------------------------
 * ==========================================================================================
 */

/** * GLOBAL CONSTANTS FOR RESULT ANALYSIS
 * Mapping based on Table Maker Logic (Deep-Dived)
 */

// 1. ANCHORS (Fixed for all formats)
const SESSION = "2025-26";
const RESULT_START_ROW = 6;    // Data starts from Row 6
const RESULT_EXAM_ROW  = 2;    // Exam names in Row 2
const RESULT_HEADER_ROW = 5;   // Subject names in Row 5
const RESULT_BASE_COL  = 4;    // First Exam starts at Column D (4)
const EXAM_GAP         = 2;    // 2 Empty columns between blocks

// 2. EXAM SERIAL NUMBERS (Hardcoded Fallback)
const EXAM_MAP = {
  "UNIT TEST 1": 0,
  "UNIT TEST 2": 1,
  "HALF YEARLY": 2,
  "ANNUAL EXAM": 3
};

// 3. TABLE FORMATS (Subject-wise Offsets from Start of Block)
// Offset 0 means the first column of that exam block
const TABLE_STRUCTURES = {
  "JUNIOR": { // Classes 6, 7, 8 (Width: 14)
    width: 14,
    subjects: {
      "Hindi": 0, "English": 1, "Science": 2, "S.St": 3, "Maths": 4, "Guj/Sans": 5,
      "Comp": 6, "Art": 7, "Music": 8, "Ph.E": 9, "Skill": 10
    },
    result: { "TOT": 11, "%": 12, "RNK": 13 }
  },
  "SENIOR": { // Classes 9, 10 (Width: 20)
    width: 20,
    subjects: {
      "Hindi": 0, "English": 1, 
      "Physics": 2, "Chemistry": 3, "Biology": 4, "Sci-Tot": 5,
      "History": 6, "Geography": 7, "Economics": 8, "Sst-Tot": 9,
      "Maths": 10, "Guj/Sans": 11,
      "Comp": 12, "Art": 13, "Music": 14, "Ph.E": 15, "Skill": 16
    },
    result: { "TOT": 17, "%": 18, "RNK": 19 }
  },
  "SR_SEC_SCI": { // Class 11, 12 Section A (Width: 10)
    width: 10,
    subjects: {
      "Hindi": 0, "English": 1, "Physics": 2, "Chemistry": 3, "Maths": 4, "Biology": 5, "Skill": 6
    },
    result: { "TOT": 7, "%": 8, "RNK": 9 }
  },
  "SR_SEC_ARTS": { // Class 11, 12 Section B (Width: 9)
    width: 9,
    subjects: {
      "Hindi": 0, "English": 1, "History": 2, "Geography": 3, "Economics": 4, "Skill": 5
    },
    result: { "TOT": 6, "%": 7, "RNK": 8 }
  }
};


/**
 * Har class ke liye exact Column Positions aur Max Marks calculate karne ka Master Function
 * Version 2.0 - Dynamic Max Marks Detection
 */
function getColumnMapping(classVal, section, examName) {
  const ss = getDB3(); 
  const sheetName = `${classVal}${section}-${SESSION}`;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;

  // --- 1. DYNAMICALLY FIND MAX MARKS ROW ---
  // UID (Column A) को Row 6 से अंत तक स्कैन करें
  const lastRow = sheet.getLastRow();
  const uidData = sheet.getRange(RESULT_START_ROW, 1, lastRow - RESULT_START_ROW + 1, 1).getValues();
  
  let maxMarksRowOffset = 0;
  for (let i = 0; i < uidData.length; i++) {
    if (!uidData[i][0] || uidData[i][0] === "") { // जहाँ UID खाली मिला
      maxMarksRowOffset = i;
      break;
    }
  }

  // Actual Row Number (e.g., अगर 40 बच्चे हैं तो 6 + 40 = Row 46)
  const actualMaxMarksRow = RESULT_START_ROW + maxMarksRowOffset;

  // --- 2. IDENTIFY TABLE FORMAT ---
  let formatKey = "";
  const cInt = parseInt(classVal);
  if (cInt <= 8) formatKey = "JUNIOR";
  else if (cInt <= 10) formatKey = "SENIOR";
  else formatKey = (section.toUpperCase() === "A") ? "SR_SEC_SCI" : "SR_SEC_ARTS";

  const config = TABLE_STRUCTURES[formatKey];
  const examIdx = EXAM_MAP[examName.toUpperCase()];

  // --- 3. FIND START COLUMN ---
  let startCol = -1;
  const examRowData = sheet.getRange(RESULT_EXAM_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  for (let i = 0; i < examRowData.length; i++) {
    if (examRowData[i].toString().trim().toUpperCase() === examName.toUpperCase()) {
      startCol = i + 1;
      break;
    }
  }

  // Fallback if exam header not found
  if (startCol === -1 && examIdx !== undefined) {
    startCol = RESULT_BASE_COL + (examIdx * (config.width + EXAM_GAP));
  }

  if (startCol === -1) throw new Error(`Exam ${examName} not found in sheet.`);

  // --- 4. MAP COLUMNS & EXTRACT MAX MARKS ---
  let finalMap = { 
    start: startCol, 
    subjects: {}, 
    result: {}, 
    maxValues: {}, // यहाँ Max Marks स्टोर होंगे
    info: {
      studentCount: maxMarksRowOffset,
      maxMarksRow: actualMaxMarksRow,
      format: formatKey
    }
  };
  
  // Max Marks वाली Row का पूरा डेटा उस Exam Block के लिए उठाएं
  const maxRowData = sheet.getRange(actualMaxMarksRow, startCol, 1, config.width).getValues()[0];

  // Map Subjects + Max Marks
  for (let sub in config.subjects) {
    let offset = config.subjects[sub];
    finalMap.subjects[sub] = startCol + offset;
    
    // Max value को साफ करके (clean) स्टोर करें
    let mVal = maxRowData[offset];
    finalMap.maxValues[sub] = (mVal && !isNaN(mVal)) ? parseFloat(mVal) : 100;
  }

  // Map Result (TOT, %, RNK)
  for (let res in config.result) {
    finalMap.result[res] = startCol + config.result[res];
  }

  return finalMap;
}



// ==========================================
// 🚀 MASTER ANALYSIS BACKEND (GLOBAL SCAN)
// ==========================================

/**
 * Pure school ka data ek baar mein fetch karta hai filter ke liye
 */
function getGlobalSchoolData(examName) {
  const ss = getDB3();
  const sheets = ss.getSheets();
  const examIdx = EXAM_MAP[examName.toUpperCase()];
  
  let allStudents = [];
  let activeClasses = 0;

  sheets.forEach(sheet => {
    const name = sheet.getName();
    // Only process class sheets like 6A-2025-26
    if (name.includes(SESSION)) {
      const parts = name.split("-")[0]; // "6A"
      const cls = parts.replace(/[A-Z]/g, '');
      const sec = parts.replace(/[0-9]/g, '');
      
      try {
        const map = getColumnMapping(cls, sec, examName);
        if (!map) return;

        const lastR = sheet.getLastRow();
        if (lastR < 6) return;

        const idData = sheet.getRange(6, 1, lastR - 5, 3).getValues();
        const pctData = sheet.getRange(6, map.result["%"], lastR - 5, 1).getValues();
        
        activeClasses++;
        
        idData.forEach((row, idx) => {
          if (row[0]) {
            allStudents.push({
              uid: row[0],
              roll: row[1],
              name: row[2],
              class: cls,
              section: sec,
              schoolLevel: getSchoolLevel(cls),
              percentage: parseFloat(pctData[idx][0]) || 0
            });
          }
        });
      } catch (e) { 
        Logger.log("Error processing " + name + ": " + e.message);
      }
    }
  });

  return {
    raw: allStudents,
    activeClasses: activeClasses,
    session: SESSION
  };
}

/**
 * Student Deep Analysis: Profile + History + Dynamic Max Marks
 */
function getStudentDeepAnalysis(uid, selectedExam) {
  const profile = fetchStudentProfile(uid); 
  if (!profile) throw new Error("Student profile not found.");

  const ss = getDB3();
  const sheetName = `${profile.class}${profile.section}-${SESSION}`;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("Result sheet not found.");
  
  // 1. Get Column Mapping (Isme Max Marks Row ka logic pehle se hai)
  const map = getColumnMapping(profile.class, profile.section, selectedExam);
  if (!map) throw new Error("Mapping failed for " + selectedExam);
  
  const lastR = sheet.getLastRow();
  const rawData = sheet.getRange(6, 1, lastR - 5, sheet.getLastColumn()).getValues();
  
  // 2. Find Student Row
  let studentRow = rawData.find(r => r[0] == uid);
  let marksCard = [];
  
  if (studentRow) {
    // 3. Map Obtained Marks + Max Marks (Using map.maxValues)
    for (let sub in map.subjects) {
      let colIdx = map.subjects[sub] - 1;
      let obtained = studentRow[colIdx];
      
      marksCard.push({
        subject: sub,
        marks: (obtained === "" || obtained === undefined) ? "N/A" : obtained,
        max: map.maxValues[sub] // ✅ Exact Location: Subject function wala logic use kiya
      });
    }
  }

  // 4. History logic (Percentage fetch karne ke liye)
  let history = [];
  for (let exName in EXAM_MAP) {
    try {
      const exMap = getColumnMapping(profile.class, profile.section, exName);
      if (studentRow && exMap) {
        let pVal = studentRow[exMap.result["%"] - 1];
        history.push({
          exam: exName,
          pct: (parseFloat(pVal) * 100).toFixed(1) || 0
        });
      }
    } catch(e) {}
  }

  return {
    profile: profile,
    marks: marksCard,
    history: history,
    summary: {
      total: studentRow ? studentRow[map.result["TOT"] - 1] : 0,
      pct: studentRow ? (parseFloat(studentRow[map.result["%"] - 1]) * 100).toFixed(1) : 0,
      rank: studentRow ? studentRow[map.result["RNK"] - 1] : "N/A"
    }
  };
}

// Helper: Get School Level
function getSchoolLevel(cls) {
  const c = parseInt(cls);
  if (c <= 8) return "JUNIOR";
  if (c <= 10) return "SENIOR";
  return "SR_SECONDARY";
}



/**
 * Class-wise Subject Detailed Data Fetcher
 * Returns: List of Students with Marks + Max Marks for each subject
 */
function getSubjectAnalysisData(classVal, section, examName) {
  try {
    // 1. Get our Dynamic Column Mapping (Version 2.0)
    const map = getColumnMapping(classVal, section, examName);
    if (!map) return { success: false, message: "Sheet or Exam not found" };

    const ss = getDB3();
    const sheetName = `${classVal}${section}-${SESSION}`;
    const sheet = ss.getSheetByName(sheetName);
    
    // 2. Identify Rows
    const startRow = RESULT_START_ROW; // Row 6
    const studentCount = map.info.studentCount;
    const maxMarksRow = map.info.maxMarksRow;

    // 3. Fetch Student Metadata (UID, Roll, Name) - Columns A, B, C
    const studentMeta = sheet.getRange(startRow, 1, studentCount, 3).getValues();

    // 4. Fetch All Marks in the Exam Block (Start Col to Block Width)
    const formatConfig = TABLE_STRUCTURES[map.info.format];
    const marksData = sheet.getRange(startRow, map.start, studentCount, formatConfig.width).getValues();

    // 5. Structure the Result for Frontend
    let studentRows = [];

    for (let i = 0; i < studentCount; i++) {
      let marksObj = {};
      
      // Har student ke liye subject wise marks map karein
      for (let sub in map.subjects) {
        let offset = map.subjects[sub] - map.start;
        let val = marksData[i][offset];
        
        // Raw values bhejna (AB, empty or numbers)
        marksObj[sub] = (val === "" || val === undefined) ? "N/A" : val;
      }

      studentRows.push({
        uid: studentMeta[i][0],
        roll: studentMeta[i][1],
        name: studentMeta[i][2],
        marks: marksObj
      });
    }

    // 6. Final Object to Frontend
    return {
      success: true,
      meta: {
        className: classVal,
        section: section,
        exam: examName,
        subjectList: Object.keys(map.subjects), // List of all subjects including totals
        maxMarks: map.maxValues // { "Maths": 20, "Physics": 33 ... }
      },
      data: studentRows
    };

  } catch (e) {
    return { success: false, message: e.toString() };
  }
} 
  



/**======================================================================================
 * 1.SHEET 4 = DB4== Global Stats: Sabhi sheets ki footer row (Annual Summary) ko sum karta hai
 =============================================================================================
 */

// Layout Constants (Based on v7.0 Student/Staff Sheets)
const FIN_START_ROW = 6;
const FIN_IDENTITY_COLS = 5; // A to E (ID, Name, etc.)
const FIN_BLOCK_WIDTH = 5;   // P, Paid, B, Rec/Vouc, Date
const FIN_GAP = 1;           // Hidden column between months
const FIN_MONTHS = ["APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER", "JANUARY", "FEBRUARY", "MARCH"];


// --- FINANCE CONFIG ---

const RECEIPT_PREFIX = "JNV/26/"; 
const VOUCHER_PREFIX = "VCH/26/";
function getFinanceGlobalStats() {
  const ss = getDB4();
  const sheets = ss.getSheets();
  let stats = { studentExp: 0, studentPaid: 0, studentDue: 0, staffExp: 0, staffPaid: 0 };

  sheets.forEach(sh => {
    const name = sh.getName();
    const lastR = sh.getLastRow();
    const lastC = sh.getLastColumn();
    if (lastR < 6) return;

    if (name.startsWith("FEE_")) {
      stats.studentExp += (sh.getRange(lastR, 5).getValue() || 0); // Col E Total
      stats.studentPaid += (sh.getRange(lastR, lastC - 2).getValue() || 0); // Tot Paid
      stats.studentDue += (sh.getRange(lastR, lastC - 1).getValue() || 0);  // Tot Due
    } 
    else if (name.startsWith("STAFF_PAYROLL")) {
      stats.staffExp += (sh.getRange(lastR, lastC - 2).getValue() || 0);  // Annual Budget
      stats.staffPaid += (sh.getRange(lastR, lastC - 1).getValue() || 0); // Tot Paid
    }
  });
  return stats;
}

/**
 * 2. Class Details: Specific month ki rows + Us month ka footer stat
 */
function getClassFinanceDetails(classVal, section, monthName) {
  try {
    const ss = getDB4();
    const sheetName = "FEE_" + classVal + section + "-26";
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return { status: false, error: "Sheet " + sheetName + " not found" };

    const lastR = sh.getLastRow();
    const lastC = sh.getLastColumn();
    if (lastR < 6) return { status: true, rows: [] };

    // April Index 5, Block width 6
    const mIdx = FIN_MONTHS.indexOf(monthName.toUpperCase());
    const mStart = 5 + (mIdx * 6); 

    // Pure range ka data fetch
    const allData = sh.getRange(6, 1, lastR - 5, lastC).getValues();
    let studentRows = [];

    for (let i = 0; i < allData.length; i++) {
      let r = allData[i];
      let colA = String(r[0] || "").trim().toUpperCase();
      let colB = String(r[1] || "").trim().toUpperCase();
      let colC = String(r[2] || "").trim().toUpperCase();

      // 🔴 CRITICAL FILTER: Agar A, B ya C column mein inmein se kuch bhi likha hai, toh skip karo
      // Kyunki merged cell "Expected Collection" aksar Col A (r[0]) mein milta hai
      const forbiddenKeywords = ["COLLECTION", "TOTAL", "EXPECTED", "GRAND", "SUM"];
      
      let isInvalidRow = forbiddenKeywords.some(key => 
        colA.includes(key) || colB.includes(key) || colC.includes(key)
      );

      // Agar ID khali hai ya keyword match ho gaya, toh row ko student mat maano
      if (colA === "" || isInvalidRow) continue;

      // Sirf valid student rows yahan tak pahunchenge
      studentRows.push({
        uid: r[0],
        roll: r[1],
        name: r[2],
        yearlyFee: parseFloat(r[4]) || 0,        // Column E
        currentDue: parseFloat(r[mStart + 2]) || 0, // Monthly Balance
        paidAmt: parseFloat(r[mStart + 1]) || 0,    // Monthly Paid
        annualDue: parseFloat(r[lastC - 2]) || 0,   // Summary Outstanding
        status: String(r[lastC - 1] || "DUE").toUpperCase() // Summary Status
      });
    }

    return { status: true, rows: studentRows };
  } catch (e) { return { status: false, error: e.toString() }; }
}

 /**
 * 🟢 NEW: Teacher ki poori list (Monthly Matrix) nikalne ke liye
 * Logic: STAFF_PAYROLL-26 sheet ko scan karke specific month ka data uthayega
 */
function getStaffMonthlyMatrix(monthName) {
  try {
    const ss = getDB4();
    const sh = ss.getSheetByName("STAFF_PAYROLL-26");
    if (!sh) return { status: false, error: "Sheet not found" };

    const lastR = sh.getLastRow();
    if (lastR < 6) return { status: true, data: [] }; // Khali sheet handle karne ke liye

    const mName = monthName.toUpperCase().trim();
    const mIdx = FIN_MONTHS.indexOf(mName);
    
    if (mIdx === -1) return { status: false, error: "Invalid Month Name: " + mName };

    // April starts at Index 5 (Col F). Offset 6 columns per month.
    const monthStartIdx = 5 + (mIdx * 6); 

    const data = sh.getRange(6, 1, lastR - 5, sh.getLastColumn()).getValues();
    let rows = [];

    for (let i = 0; i < data.length; i++) {
      let r = data[i];
      let uid = String(r[0] || "").trim();
      
      // Skip empty or Total rows
      if (uid === "" || uid.toUpperCase().includes("TOTAL")) continue;

      rows.push({
        uid: uid,
        desig: r[1],
        name: r[2],
        basic: parseFloat(r[4]) || 0,
        paid: parseFloat(r[monthStartIdx + 1]) || 0,
        deduct: parseFloat(r[monthStartIdx + 2]) || 0,
        voucher: r[monthStartIdx + 3] || '--'
      });
    }

    return { status: true, data: rows };
  } catch (e) {
    return { status: false, error: e.toString() };
  }
}

/**
 * 3. Student Deep Dive: ID search karke poora data return karta hai
 */
function getStudentFinDeepDive(uid) {
  const profile = fetchStudentProfile(uid); 
  if (!profile) return null;

  const ss = getDB4();
  const sheetName = `FEE_${profile.class}${profile.section}-26`;
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return null;
  
  const data = sh.getDataRange().getValues();
  const lastC = sh.getLastColumn();
  
  // Find specific student row
  const row = data.find(r => String(r[0]) === String(uid));
  if (!row) return null;

  let history = [];
  FIN_MONTHS.forEach((m, i) => {
    // Exact Indexing: Month 1 (April) starts at index 5 (Col F)
    // Offset per month is 6 (5 data + 1 gap)
    let startIdx = 5 + (i * 6);
    history.push({
      month: m,
      payable: row[startIdx],      // P
      paid: row[startIdx + 1],     // Paid
      balance: row[startIdx + 2],  // B
      receipt: row[startIdx + 3],  // Rec/Vouc
      date: row[startIdx + 4]      // Date
    });
  });

  return {
    profile: profile,
    monthly: history,
    summary: {
      yearlyFee: row[4],                    // Column E
      totalPaid: row[lastC - 3],            // Total Paid (End of sheet)
      remaining: row[lastC - 2],            // Total Due (End of sheet)
      status: row[lastC - 1]                // Final Status
    }
  };
}

/**
 * 4. Staff Deep Dive: Teacher payroll logic (Monthly fresh calculation)
 */
function getStaffFinDeepDive(uid) {
  const ss = getDB4();
  const sh = ss.getSheetByName("STAFF_PAYROLL-26");
  const data = sh.getDataRange().getValues();
  
  const row = data.find(r => String(r[0]) === String(uid));
  if (!row) return null;

  let payroll = [];
  FIN_MONTHS.forEach((m, i) => {
    let c = 5 + (i * 6);
    payroll.push({ month: m, basic: row[c], paid: row[c+1], deduct: row[c+2], voucher: row[c+3], date: row[c+4] });
  });

  return {
    identity: { id: row[0], desig: row[1], name: row[2], subject: row[3], monthlyFixed: row[4] },
    monthly: payroll,
    annual: {
      budget: row[sh.getLastColumn() - 3],
      paid: row[sh.getLastColumn() - 2],
      totalDeduct: row[sh.getLastColumn() - 1]
    }
  };
}

function getOpsExpenses(monthName) {
  const sh = getDB4().getSheetByName("OPERATIONAL_EXPENSES");
  const lastR = sh.getLastRow();
  
  
  if (lastR < 5) return [];

  
  const data = sh.getRange(5, 1, lastR - 4, 12).getValues();

  // 3. FILTERING LOGIC
  const filtered = data.filter(r => {
    
    if (!r[4]) return false; 
    
    if (monthName === "ANNUAL") return true;
    
    // Month name matching (Column C is Index 2)
    return String(r[2]).toUpperCase() === monthName.toUpperCase();
  });

  // 4. MAPPING TO JSON
  return filtered.map(r => ({
    timestamp: r[0], 
    date: r[1], 
    month: r[2], 
    category: r[3],
    title: r[4], 
    amount: parseFloat(r[5]) || 0, // Ensure numeric value
    method: r[6], 
    user: r[7],
    vendor: r[8], 
    status: r[9], 
    ref: r[10], 
    busNo: r[11]
  }));
}


function saveExpenseEntry(p) {
  const sh = getDB4().getSheetByName("OPERATIONAL_EXPENSES");
  
  var dateForMonth = new Date(p.date);
  var monthText = Utilities.formatDate(dateForMonth, Session.getScriptTimeZone(), "MMMM").toUpperCase();

  const row = [
    new Date(),   // A: Timestamp
    p.date,       // B: Date
    monthText,    // C: Month
    p.category,   // D: Category
    p.title,      // E: Title
    p.amount,     // F: Amount
    p.method,     // G: Method
    p.user,       // H: User
    p.vendor || "N/A", // I: Vendor
    p.status,     // J: Status
    p.ref,        // K: Ref
    p.busNo       // L: Bus
  ];
  
  sh.appendRow(row);

  // 🟢 NEW: Activity Feed Notification Hook
  // Location: appendRow (Database entry) hone ke baad
  sendPushNotification(
    "New Expense Recorded", 
    `${p.category}: ₹${p.amount} (${p.title})`, 
    { type: "INFO", category: p.category, amount: p.amount }
  );

  return { status: true };
}

/**
 * Master Logic: Entry Log karna aur Frontend PDF ko Drive mein save karna
 */


function processTransactionWithFile(p, type) {
  const ss4 = getDB4();
  const logSheetName = (type === "STUDENT") ? "FEE_TRANSACTION_LOGS" : "PAYROLL_LOGS";
  const sh = ss4.getSheetByName(logSheetName);
  const config = getMasterConfig();
  
  if (!sh) return { success: false, message: "Log sheet not found" };

  // =========================================================================
  // 🟢 1. SMART PROFILE FETCHER (Perfectly Separated)
  // =========================================================================
  let userProfile = null;
  if (type === "STUDENT") {
    userProfile = fetchStudentProfile(p.uid);
  } else {
    // STAFF ke liye data fetch
    let allTeachers = fetchTeachers();
    userProfile = allTeachers.find(t => String(t.id).trim() === String(p.uid).trim());
    // Failsafe: Agar ID match na ho tab bhi PDF crash na ho
    if(!userProfile) userProfile = { name: p.name, photo: "", email: "", mobile: "", contact: "" };
  }

  // =========================================================================
  // 2. UNIQUE RECEIPT/VOUCHER ID GENERATION
  // =========================================================================
  const nextIdNum = sh.getLastRow() - 2;
  const finalId = (type === "STUDENT" ? RECEIPT_PREFIX : VOUCHER_PREFIX) + nextIdNum.toString().padStart(4, '0');

  // =========================================================================
  // 3. GENERATE PDF & SAVE TO DRIVE
  // =========================================================================
  let fileUrl = "NO_FILE";
  let pdfBase64 = "";
  let receiptHtmlForEmail = "";
  
  try {
    let receiptHtmlForPdf = "";
    if (type === "STUDENT") {
     receiptHtmlForPdf = generateAttractiveReceiptHtml(p, config, finalId, "#", userProfile, true);
     } else {
    // STAFF ke liye Naya Salary Wala Template Use Hoga
       receiptHtmlForPdf = generateAttractiveSalaryHtml(p, config, finalId, "#", userProfile, true);
     }
    const pdfBlob = Utilities.newBlob(receiptHtmlForPdf, 'text/html', `${finalId}.html`).getAs('application/pdf');
    
    const folderId = (type === "STUDENT") ? config.folderReceipts : config.folderSalary;
    const folder = DriveApp.getFolderById(folderId);
    
    const cleanName = String(p.name || "Unknown").replace(/[^a-zA-Z0-9 ]/g, "_");
    const file = folder.createFile(pdfBlob).setName(`Receipt_${finalId}_${cleanName}.pdf`);
    
    try {
       file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(shareError) {
       Logger.log("Sharing blocked by admin, but file is saved.");
    }
    
    fileUrl = file.getUrl(); 
    pdfBase64 = Utilities.base64Encode(pdfBlob.getBytes());
    
  } catch (e) { 
    Logger.log("Critical Error in PDF/Drive: " + e.message); 
    fileUrl = "ERROR: " + e.message; 
  }
  
  // =========================================================================
  // 4. DATABASE LOGGING (13-Col for Student, 11-Col for Staff)
  // =========================================================================
  try {
    let logRow = [];
    
    if (type === "STUDENT") {
      // 🔵 STUDENT: Purana 13-column format
      logRow = [
        finalId, new Date(), p.uid || "N/A", p.roll || (userProfile ? userProfile.roll : "N/A") || "N/A", 
        p.name || "Unknown", p.classVal || "N/A", p.month || "N/A", p.amount || 0, 
        p.mode || "CASH", p.trxId || "N/A", fileUrl, "PAID", p.operator || "SYSTEM"
      ];
    } else {
      // 🟠 TEACHER: Exact 11-column format jo aapne bataya hai
      logRow = [
        finalId,                     // 1. Voucher ID
        new Date(),                  // 2. Timestamp
        p.uid || "N/A",              // 3. UID
        p.name || "Unknown",         // 4. Staff Name
        p.month || "N/A",            // 5. Salary Month
        p.amount || 0,               // 6. Net Paid
        p.deduction || 0,            // 7. Deduction
        p.mode || "BANK_TRANSFER",   // 8. Payment Mode
        fileUrl,                     // 9. PDF Slip Link
        "SYNCED",                    // 10. Sync Status
        p.operator || "SYSTEM"       // 11. Operator
      ];
    }
    
    sh.appendRow(logRow);
    sendPushNotification(
      type === "STUDENT" ? "Fee Payment Logged" : "Salary Payment Logged",
      `${type === "STUDENT" ? 'Student' : 'Staff'} ${p.name || 'Unknown'} - ₹${p.amount || 0}`,
      { 
        type: type === "STUDENT" ? "FINANCE_SYNC" : "PAYROLL_SYNC", 
        uid: p.uid, 
        amount: p.amount 
      }
    );
  } catch (e) {
    Logger.log("Critical Error in DB Logging: " + e.toString());
  }

  // =========================================================================
  // 5. AUTOMATIC NOTIFICATIONS (Email & WhatsApp - Students Only)
  // =========================================================================
  // =========================================================================
  // 5. AUTOMATIC NOTIFICATIONS (Email & WhatsApp - Dono Ke Liye)
  // =========================================================================
  let emailSent = false;
  
  if (userProfile) {
      
      // A. Independent Email Trigger
      if (userProfile.email) {
          try {
            if (type === "STUDENT") {
              // 🟢 STUDENT KO GREEN RECEIPT JAYEGI
              receiptHtmlForEmail = generateAttractiveReceiptHtml(p, config, finalId, fileUrl, userProfile, false);
              sendBrandedEmail(userProfile.email, `Fee Receipt: ${p.month} (${finalId})`, "FEE", receiptHtmlForEmail);
            } else {
              // 🔵 TEACHER KO BLUE SALARY SLIP JAYEGI
              receiptHtmlForEmail = generateAttractiveSalaryHtml(p, config, finalId, fileUrl, userProfile, false);
              sendBrandedEmail(userProfile.email, `Salary Payslip: ${p.month} (${finalId})`, "PAYROLL", receiptHtmlForEmail);
            }
            emailSent = true;
          } catch (err) { Logger.log("Email Error: " + err.message); }
      }
      
      // B. Independent WhatsApp Trigger
      // Note: Teacher profile mein number 'mobile' mein hota hai, Student mein 'contact' mein
      let phoneNo = userProfile.mobile || userProfile.contact; 
      
      if (phoneNo) {
          try { 
            if (type === "STUDENT") {
              // 🟢 Student Fee WhatsApp Call
              sendWhatsAppFeeConfirmation(phoneNo, p.name, p.amount, p.month, p.trxId || finalId, p.mode); 
            } else {
              // 🔵 Teacher Salary WhatsApp Call
              sendWhatsAppSalaryAlert(phoneNo, p.name, p.month, p.amount, finalId, p.mode);
            }
          } catch (err) { Logger.log("WA Error: " + err.message); }
      }
  }

  return { 
    success: true, 
    message: emailSent ? "Transaction Logged & Notifications Sent" : "Transaction Logged", 
    data: { id: finalId, url: fileUrl, pdfData: pdfBase64 } 
  };
}




/**
 * DATA BRIDGE INTELLIGENCE ENGINE (Sync Optimized)
 * Table 1: B6:E19 | Table 2: B30:E41 | Table 3: G6:G20 | Table 4: G30:K41
 */

function getFinanceDashboardData(monthName) {
  try {
    const ss = getDB4();
    // ⚠️ Ensure sheet name is exactly "DATA_BRIDGE" in your Google Sheet
    const sh = ss.getSheetByName("DATA_BRIDGE"); 
    if (!sh) return { success: false, message: "Sheet 'DATA_BRIDGE' not found in DB4" };

    if (!monthName) return { success: false, message: "No month specified" };

    // 1. FAST SCAN: Row 1 to 50, Col A to T (50x20 Matrix)
    const fullData = sh.getRange(1, 1, 50, 20).getValues(); 
    
    // Internal Helper: 1-based to 0-based coordinate matching
    const getVal = (row, col) => {
      try { return fullData[row - 1][col - 1] || 0; } 
      catch(e) { return 0; }
    };

    // Use Global FIN_MONTHS defined at the top of your script
    const selectedMonth = monthName.toUpperCase().trim();
    const monthIdx = FIN_MONTHS.indexOf(selectedMonth);
    
    if (monthIdx === -1) return { success: false, message: "Invalid Month: " + selectedMonth };

    // ==========================================
    // TABLE 1: STUDENT REVENUE (B6:E19)
    // ==========================================
    let revenueRows = [];
    for (let i = 6; i <= 19; i++) {
      let className = getVal(i, 2); // Col B
      if(className) {
        revenueRows.push({
          class: className,
          expected: getVal(i, 3),  // Col C
          collected: getVal(i, 4), // Col D
          pending: getVal(i, 5)    // Col E
        });
      }
    }
    const revenueTotals = {
      expected: getVal(23, 3),  // C23
      collected: getVal(23, 4), // D23
      pending: getVal(23, 5)    // E23
    };

    // ==========================================
    // TABLE 2: STAFF PAYROLL (B30:E41)
    // ==========================================
    let payrollRows = [];
    for (let i = 30; i <= 41; i++) {
      payrollRows.push({
        month: getVal(i, 2),    // Col B
        budget: getVal(i, 3),   // Col C
        paid: getVal(i, 4),     // Col D
        pending: getVal(i, 5)   // Col E
      });
    }
    const payrollTotals = {
      budget: getVal(47, 3), // C47
      paid: getVal(47, 4),   // D47
      pending: getVal(47, 5) // E47
    };

    // ==========================================
    // TABLE 3: OPERATIONAL COST (G6:G20 + Selected Month Col)
    // Month data starts from Col H (8)
    // ==========================================
    let opsBreakdown = [];
    const opsCol = 8 + monthIdx; // April is H (8), May is I (9)...
    for (let i = 6; i <= 20; i++) {
      let amt = getVal(i, opsCol);
      if (amt > 0) { 
        opsBreakdown.push({
          category: getVal(i, 7), // Col G (Label)
          amount: amt
        });
      }
    }
    const monthlyOpsTotal = getVal(22, opsCol); // Row 22 Total

    const cfRow = 30 + monthIdx; // Row 30 is April
    const currentCashflow = {
      income: getVal(cfRow, 8),   // Col H
      salary: getVal(cfRow, 9),   // Col I
      ops: getVal(cfRow, 10),     // Col J
      margin: getVal(cfRow, 11)   // Col K
    };

    const annualPerformance = {
      totalIncome: getVal(47, 8), // H47
      totalSalary: getVal(47, 9), // I47
      totalOps: getVal(47, 10),    // J47
      netProfit: getVal(47, 11)   // K47
    };

    return {
      success: true,
      month: selectedMonth,
      revenue: { list: revenueRows, totals: revenueTotals },
      payroll: { list: payrollRows, totals: payrollTotals },
      ops: { breakdown: opsBreakdown, total: monthlyOpsTotal },
      cashflow: { current: currentCashflow, annual: annualPerformance }
    };

  } catch (err) {
    Logger.log("Bridge Sync Critical Error: " + err.toString());
    return { success: false, message: "Engine Error: " + err.toString() };
  }
}



/**
 * Master Intelligence for Landing Page
 * UPDATED: Now includes Active Arrangements from DB5
 */

function getHomeDashboardData() {
  const ss = getDB1();
  const db2 = getDB2();
  const db5 = getDB5(); // 🟢 NEW: Connect to Time Table Database
  
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  
  // KPI Dashboard Storage
  const kpis = {
    studentTotal: ss.getSheetByName("Student_Data").getLastRow() - 5,
    studentPresent: 0, studentAbsent: 0, studentLeave: 0, studentOD: 0,
    staffTotal: ss.getSheetByName("Teacher_Data").getLastRow() - 5,
    staffAbsent: 0
  };

  const absentStudents = [];
  const absentStaff = [];

  // --- 1. EXISTING ATTENDANCE LOGIC ---
  const stuLogs = ss.getSheetByName("Attendance_Logs").getDataRange().getValues();
  const teaLogs = ss.getSheetByName("Teacher_Attendance_Logs").getDataRange().getValues();
  const allTeachers = fetchTeachers(); 

  // Process Student Attendance
  stuLogs.forEach(row => {
    if (formatSheetDate(row[0]) === today) {
      const status = row[6];
      if (status === 'P') kpis.studentPresent++;
      else if (status === 'A') {
        kpis.studentAbsent++;
        const profile = fetchStudentProfile(row[1]); 
        const hist = getMemberHistory(stuLogs, row[1], 3);
        absentStudents.push({
          uid: row[1], name: row[3], class: row[4],
          email: profile ? profile.email : "",
          photo: profile ? profile.photo : "",
          history: hist.statuses,
          streak: hist.absentCount
        });
      }
      else if (status === 'L') kpis.studentLeave++;
      else if (status === 'OD') kpis.studentOD++;
    }
  });

  // Process Staff Attendance
  teaLogs.forEach(row => {
    if (formatSheetDate(row[0]) === today) {
      if (row[4] === 'A') {
        kpis.staffAbsent++;
        const teacher = allTeachers.find(t => t.id == row[1]);
        const hist = getMemberHistory(teaLogs, row[1], 3);
        absentStaff.push({
          uid: row[1], name: row[2], designation: row[3],
          email: teacher ? teacher.email : "",
          photo: teacher ? teacher.photo : "",
          history: hist.statuses,
          streak: hist.absentCount
        });
      }
    }
  });

  // --- 2. 🟢 NEW: FETCH SUBSTITUTIONS FROM DB5 ---
  let substitutions = [];
  try {
    const subSheet = db5.getSheetByName("Substitution_Logs");
    if (subSheet && subSheet.getLastRow() > 5) {
      // Fetch Raw Data
      const rawLogs = subSheet.getRange(6, 1, subSheet.getLastRow() - 5, 15).getValues();
      
      // Filter for TODAY & Map to Frontend Keys
      substitutions = rawLogs.filter(function(r) {
         return formatSheetDate(r[0]) === today;
      }).map(function(r) {
         return {
           date: r[0],
           slot: r[1],
           className: r[2],
           absentTeacher: r[3],
           substitute: r[5],
            remarks: "Active",
            colL: r[11] || "", 
            colM: r[12] || "",
            colN: r[13] || "",
            colO: r[14] || ""
         };
      });
    }
  } catch (e) {
    Logger.log("Error fetching substitutions: " + e.toString());
  }

  // --- 3. News & Notices from DB2 ---
  const notices = db2.getSheetByName("Notices").getDataRange().getValues()
                  .slice(1).reverse().slice(0, 5)
                  .map(r => ({ title: r[1], type: r[5], date: formatDate(r[3]) }));

  // Return Data including 'substitutions' array
  return { 
    status: true, 
    data: { kpis, absentStudents, absentStaff, notices, substitutions } 
  };
}


/**
 * Helper: Google Sheet ki date ko standard yyyy-MM-dd format mein badalna
 * Iske bina attendance logic compare nahi ho payega.
 */

function formatSheetDate(dateVal) {
  try {
    if (!dateVal || dateVal === "") return "";
    // Agar date object hai toh format karein, agar string hai toh use date banakar format karein
    const dateObj = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
    return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd");
  } catch(e) {
    return "";
  }
}
 
/**
 * Helper: Kisi member (Student/Staff) ki history scan karna
 * Dashboard par Red/Green dots dikhane ke liye zaroori hai.
 */

function getMemberHistory(data, uid, days) {
  let statuses = [];
  let absentCount = 0;
  
  // Member ki saari entries filter karein aur date ke hisaab se sort karein (Newest first)
  const entries = data.filter(r => r[1] == uid).sort((a,b) => new Date(b[0]) - new Date(a[0]));
  
  // Pichle 'days' (3 din) ka data uthayein
  for(let i=0; i < Math.min(entries.length, days); i++) {
    // Student sheet mein status Col 6 par hai, Teacher mein Col 4 par
    const status = entries[i][6] || entries[i][4]; 
    statuses.push(status);
    if(status === 'A') absentCount++;
  }
  
  return { 
    statuses: statuses.reverse(), // Reverse taaki UI par piche se aage dikhe
    absentCount: absentCount 
  };
}

/** ============================================================================================
 * =======  db5 time table and arrengement functions ============================================
 * =============================================================================================*/

/**
 * 🛠️ ROBUST DATE HELPER
 * Date String ("2026-01-15") se Day Name ("THURSDAY") nikalta hai.
 * Fix: Uses Google's TimeZone to prevent day shifting.
 */

function getDayName(dateStr) {
  if (!dateStr) return "";
  
  // String ko Date object mein badalna
  var parts = dateStr.split("-"); // [2026, 01, 15]
  // Note: Month 0-indexed hota hai JS mein (0 = Jan)
  var dateObj = new Date(parts[0], parts[1] - 1, parts[2]); 

  // Google ke format utility se Day nikalo (Safe Method)
  return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "EEEE").toUpperCase();
}

/**
 * 🛡️ GATEKEEPER: ABSENT TEACHER LIST
 * Sheet scan karke Absent IDs nikalta hai.
 */

function getAbsentTeachersList(targetDateStr) {
  var ss = getDB1();
  var sh = ss.getSheetByName("Teacher_Attendance_Logs");
  
  // Last 500 rows hi padho (Optimization) - Agar data bahut purana hai to load na ho
  var lastRow = sh.getLastRow();
  var startRow = Math.max(6, lastRow - 500); // Kam se kam Row 6 se shuru ho
  
  if (lastRow < 6) return []; // Sheet khali hai

  // Data range: Row X se end tak
  var data = sh.getRange(startRow, 1, lastRow - startRow + 1, 5).getValues();
  var absentees = [];

  for (var i = 0; i < data.length; i++) {
    // Column Index Mapping (0-based in array)
    // Sheet Cols: A(0)=Date, B(1)=ID, C=Name, D=Desig, E(4)=Status
    
    if (!data[i][0]) continue; // Skip empty date rows

    var sheetDate = "";
    try {
      // Sheet ki timestamp ko Frontend format (yyyy-MM-dd) mein convert karo
      sheetDate = Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    } catch(e) { continue; }

    // Check Match
    if (sheetDate === targetDateStr) {
       var status = String(data[i][4]).trim().toUpperCase(); // Column E
       
       // Agar Absent (A) ya Leave (L) hai, toh list mein daalo
       if (status === "A" || status === "L") {
         absentees.push(String(data[i][1]).trim()); // ID store karo
       }
    }
  }
  return absentees;
}



/**
 * ⚡ SMART ARRANGEMENT ENGINE (FINAL VERSION)
 * Replaces both 'generateArrangementDraft' and 'findAvailableSubstitutes'
 */

function generateArrangementDraft(dateStr) {
  var dayName = getDayName(dateStr).toUpperCase();
  if (dayName === "SUNDAY") return { success: false, message: "Sunday is a Holiday." };

  // 1. GATEKEEPER: Get Absentees List
  var absentIds = getAbsentTeachersList(dateStr); 
  if (absentIds.length === 0) return { success: false, message: "No absentees found for " + dateStr };

  // 2. MASTER DATA FETCH (Optimized)
  var ss1 = getDB1();
  var teacherSheet = ss1.getSheetByName("Teacher_Data");
  var tRaw = teacherSheet.getRange(6, 1, teacherSheet.getLastRow()-5, 16).getValues();

  var teacherMeta = {};
  var validTeacherIds = [];
  
  // Build Metadata Map & Available Pool
  tRaw.forEach(function(r) {
    var id = String(r[0]).trim();
    if(id) {
      teacherMeta[id] = {
        name: r[1],
        desig: String(r[6]).toUpperCase(),
        subject: String(r[7]).toUpperCase(),
        photo: r[15],
        // VIP Detection
        isVIP: String(r[6]).toUpperCase().includes("PRINCIPAL") || String(r[6]).toUpperCase().includes("VICE")
      };
      // Gatekeeper Check: Only add if NOT absent
      if(absentIds.indexOf(id) === -1) {
        validTeacherIds.push(id);
      }
    }
  });

  // 3. WORKLOAD CALCULATOR (Scan TT once)
  var ss5 = getDB5();
  var ttSh = ss5.getSheetByName("Teacher_wiseTT");
  var ttData = ttSh.getDataRange().getValues();

  var dailyLoadMap = {}; 
  var periodCols = [5, 6, 7, 8, 10, 11, 12, 13]; // Columns F, G, H, I, K, L, M, N
  var periodNames = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"];

  validTeacherIds.forEach(id => dailyLoadMap[id] = 0);

  // Calculate Today's Load for Available Teachers
  for (var r = 4; r < ttData.length; r++) {
    var tId = String(ttData[r][0]).trim();
    var tDay = String(ttData[r][4]).toUpperCase();
    
    if (tDay === dayName && validTeacherIds.indexOf(tId) !== -1) {
      var count = 0;
      periodCols.forEach(idx => {
        if (ttData[r][idx] && ttData[r][idx] !== "-" && ttData[r][idx] !== "OFF") count++;
      });
      dailyLoadMap[tId] = count;
    }
  }

  // 4. GENERATE DRAFT WITH SCORING
  var draft = [];

  absentIds.forEach(function(absentId) {
    // Find Absent Teacher's Schedule Row
    var targetRow = ttData.find(r => String(r[0]).trim() === String(absentId).trim() && String(r[4]).trim().toUpperCase() === dayName);
    
    if (targetRow) {
      var absMeta = teacherMeta[absentId] || { name: targetRow[1], subject: "GEN", desig: "TGT" };

      periodCols.forEach(function(colIdx, i) {
        var classAssigned = String(targetRow[colIdx]).trim();
        
        // If substitution needed
        if (classAssigned !== "-" && classAssigned !== "OFF" && classAssigned !== "") {
          
          var candidates = [];

          // Scan for Substitutes
          for (var k = 4; k < ttData.length; k++) {
             var candId = String(ttData[k][0]).trim();
             var candDay = String(ttData[k][4]).toUpperCase();

             // Check Availability & Presence
             if (validTeacherIds.indexOf(candId) !== -1 && candDay === dayName) {
                
                // Check if Free in this Slot
                var currentSlotVal = String(ttData[k][colIdx]).trim();
                if (currentSlotVal === "-" || currentSlotVal === "") {
                   
                   var candMeta = teacherMeta[candId];
                   var currentLoad = dailyLoadMap[candId] || 0;

                   // --- SCORING ALGORITHM ---
                   var score = 100; // Base Score

                   // Bonus: Subject Match
                   if (candMeta.subject === absMeta.subject) score += 50;
                   // Bonus: Designation Match
                   if (candMeta.desig === absMeta.desig) score += 20;
                   // Penalty: Workload > 5
                   if (currentLoad > 5) score -= (currentLoad - 5) * 20;
                   // Penalty: Admin Role (VIP)
                   if (candMeta.isVIP) score -= 500;

                   candidates.push({
                     id: candId,
                     name: candMeta.name,
                     photo: candMeta.photo,
                     desig: candMeta.desig,
                     load: currentLoad,
                     score: score,
                     isAdminRole: candMeta.isVIP
                   });
                }
             }
          }

          // Sort by Score (Desc) -> Load (Asc)
          candidates.sort((a, b) => b.score - a.score || a.load - b.load);

          draft.push({
            absentId: absentId,
            absentName: absMeta.name,
            absentPhoto: absMeta.photo,
            period: periodNames[i],
            className: classAssigned,
            suggestions: candidates.length > 0 ? candidates : [{id: "NONE", name: "⚠️ NO TEACHER FREE", photo: "", load:0}]
          });
        }
      });
    }
  });

  return { success: true, data: draft };
} 

/**
 * 🛡️ ULTIMATE NOTIFY ENGINE (BATCHED & FIXED)
 * 1. Groups multiple assignments for the same teacher.
 * 2. Sends 1 Consolidated Email (Table format).
 * 3. Sends 1 Consolidated WhatsApp (Linear String format to avoid API Error).
 */
function saveSubstitutionLogs(logs) {
  var ss = getDB5();
  var sh = ss.getSheetByName("Substitution_Logs");
  
  if (!sh) {
    sh = ss.insertSheet("Substitution_Logs");
    sh.appendRow(["Date", "Slot", "Class", "Absent Teacher", "Absent ID", "Substitute Teacher", "Substitute ID", "Allotted By", "Email Status", "WhatsApp Status", "Timestamp"]);
  }

  // 1. DATA PREP
  var allTeachers = fetchTeachers(); 
  var config = getMasterConfig();
  
  var teacherMap = {};
  allTeachers.forEach(function(t) {
    var safeId = String(t.id).trim();
    if(safeId) {
      teacherMap[safeId] = { 
        email: String(t.email || "").trim(), 
        mobile: String(t.mobile || "").trim(), 
        name: t.name 
      };
    }
  });

  var timestamp = new Date();
  var rowsToSave = [];
  var batches = {}; // 🟢 THIS OBJECT HOLDS GROUPED DATA
  
  // 2. BUILD BATCHES (Data Grouping Logic)
  logs.forEach(function(r, index) {
    
    // Slot Cleaning
    var rawSlot = r.period || r.slot || "UNK";
    var slotName = String(rawSlot).trim().toUpperCase();
    if (slotName.includes("-")) slotName = slotName.split("-").pop();
    if (/^\d+$/.test(slotName)) slotName = "P" + slotName;
    if (!slotName.startsWith("P") && slotName.length < 3) slotName = "P" + slotName.replace("P","");

    var subId = String(r.substituteId).trim();
    var subTeacher = teacherMap[subId];
    
    // Initial Statuses
    var emailStatus = "PENDING";
    var waStatus = "PENDING";

    if (subTeacher) {
      // Create a bucket for this teacher if not exists
      if (!batches[subId]) {
        batches[subId] = {
          teacherName: subTeacher.name,
          email: subTeacher.email,
          mobile: subTeacher.mobile,
          tasks: [],      // Array to hold all periods for this teacher
          rowIndices: []  // To update status back to sheet later
        };
      }
      
      // Add this specific task to the teacher's bucket
      batches[subId].tasks.push({
        date: r.date,
        slot: slotName,
        className: r.className,
        absentTeacher: r.absentTeacher
      });
      
      batches[subId].rowIndices.push(index);
      
    } else {
      emailStatus = "ID NOT FOUND";
      waStatus = "ID NOT FOUND";
    }

    // Push Placeholder Row (Statuses will be updated in Step 3)
    rowsToSave.push([
      r.date, slotName, r.className, r.absentTeacher, r.absentId, 
      r.substitute, subId, r.adminName, emailStatus, waStatus, timestamp
    ]);
  });

  // 3. EXECUTE BATCHES (One Loop = One Message per Teacher)
  Object.keys(batches).forEach(function(tId) {
    var batch = batches[tId];
    var eStat = "SKIPPED";
    var wStat = "SKIPPED";

    // A. EMAIL BATCH (Sends HTML Table of all tasks)
    // A. EMAIL BATCH (Sends Branded Email with Watermark)
    if (batch.email && batch.email.includes("@")) {
     try {
     var htmlBody = generateConsolidatedEmailHtml(batch.teacherName, batch.tasks, config);
      var subject = `Substitution Duty: ${batch.tasks.length} Arrangement(s) Assigned`;
    
      // Branded function ko call kiya 👇
      var res = sendBrandedEmail(batch.email, subject, "SUBSTITUTION", htmlBody);
    
       eStat = res ? "SENT" : "FAIL";
     } catch(e) { eStat = "FAIL"; }
    }
    
    else { eStat = "NO EMAIL"; }

    // B. WHATSAPP BATCH (Sends Linear String)
    if (batch.mobile && batch.mobile.length >= 10) {
      try {
        // 🟢 CRITICAL FIX: Join with separator ' | ' instead of '\n'
        // This creates ONE string for Variable {{3}} containing all tasks
        var listString = batch.tasks.map(function(t) {
            return `👉 ${t.slot}: ${t.className}`;
        }).join("  |  "); 

        var waRes = sendSubstitutionWhatsApp(
            batch.mobile, 
            batch.teacherName,     // Variable {{1}}
            batch.tasks[0].date,   // Variable {{2}}
            listString,            // Variable {{3}} (Consolidated List)
            config.schoolName      // Variable {{4}}
        );
        wStat = waRes ? "SENT" : "FAIL";
      } catch(e) { wStat = "FAIL"; }
    } else { wStat = "NO PHONE"; }

    // Update Statuses in Main Array for all rows belonging to this teacher
    batch.rowIndices.forEach(function(rowIndex) {
      rowsToSave[rowIndex][8] = eStat; // Col I (Email Status)
      rowsToSave[rowIndex][9] = wStat; // Col J (WA Status)
    });
  });

  // 4. SAVE TO SHEET
  if (rowsToSave.length > 0) {
    var nextRow = Math.max(sh.getLastRow() + 1, 6);
    sh.getRange(nextRow, 1, rowsToSave.length, 11).setValues(rowsToSave);
    return { success: true, message: rowsToSave.length + " Logs Saved. Notifications Sent." };
  }
  return { success: false, message: "No data" };
}





/**
 * ⚡ ULTIMATE LIVE MATRIX ENGINE V4
 * Logic: Period_Timings + (Class_wiseTT / Teacher_wiseTT) + Substitution_Logs
 */
function getLiveMatrix(e) {
  var params = e.parameter;
  var viewMode = params.viewMode || "CLASS"; // "CLASS" or "TEACHER"
  var reqDateStr = params.date; // "yyyy-MM-dd" form frontend
  
  var ss = getDB5(); 
  
  // --- 1. DATE & TIME LOGIC ---
  var today = new Date();
  var reqDate = new Date(reqDateStr);
  var todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");
  
  // Check if requested date is TODAY (for Live Green Status)
  var isToday = (reqDateStr === todayStr);
  var currentTime = isToday ? (today.getHours() * 60 + today.getMinutes()) : -1;

  var days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  var dayName = days[reqDate.getDay()];
  
  // --- 2. FETCH STRUCTURE (Period_Timings) ---
  // Starts Row 5. Cols: [0]Slot, [1]Start, [2]End, [3]Dur, [4]Class
  var timeSheet = ss.getSheetByName("Period_Timings");
  var timeData = timeSheet.getRange(5, 1, timeSheet.getLastRow()-4, 5).getValues(); 

  // --- 3. FETCH SUBSTITUTIONS (Using 11-Col Structure) ---
  // A:Date, B:Slot, C:Class, D:AbsentName, E:AbsID, F:SubName, G:SubID
  var subSheet = ss.getSheetByName("Substitution_Logs");
  var subData = subSheet ? subSheet.getDataRange().getValues() : [];
  
  // Filter logs for requested date ONLY
  var dayLogs = subData.filter(function(r) {
    try { 
      var logDate = Utilities.formatDate(new Date(r[0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
      return logDate === reqDateStr; 
    } catch(e) { return false; }
  });

  // --- 4. COLUMN MAPS ---
  // Class TT: P1=C(2), Break=G(6), P8=K(10)
  var classSlotMap = { "P1":2, "P2":3, "P3":4, "P4":5, "P5":7, "P6":8, "P7":9, "P8":10 };
  // Teacher TT: P1=F(5), P8=N(13)
  var teacherSlotMap = { "P1":5, "P2":6, "P3":7, "P4":8, "P5":10, "P6":11, "P7":12, "P8":13 };
  
  var matrix = [];
  var headers = []; // To send dynamic headers to frontend

  // ======================================================
  // 🅰️ CLASS VIEW LOGIC (Read from Class_wiseTT)
  // ======================================================
  if (viewMode === "CLASS") {
    var sheet = ss.getSheetByName("Class_wiseTT");
    var allData = sheet.getRange(5, 1, sheet.getLastRow()-4, 11).getValues();
    var dayRows = allData.filter(r => String(r[1]).toUpperCase() === dayName);
    
    // Sort Class Names (6A, 6B... 12B)
    dayRows.sort((a,b) => String(a[0]).localeCompare(String(b[0]), undefined, {numeric: true}));

    matrix = dayRows.map(row => {
      var classId = row[0]; // "10A"
      var rowPeriods = [];
      
      // Iterate through Timings to build row cells
      for(var i=0; i<timeData.length; i++) {
        var tRow = timeData[i];
        var slotName = String(tRow[0]).trim().toUpperCase();
        var type = String(tRow[4]).trim().toUpperCase(); // ACADEMIC / BREAK

        if (type === 'BREAK') {
           // Skip breaks in matrix or handle as special cell (frontend handles skip)
           continue; 
        }

        // Base Data
        var cell = { 
          slot: slotName,
          type: "FREE", 
          text: "-", 
          subText: "", 
          tooltip: "",
          isPast: false
        };

        // Time Check
        if(isToday) {
           var tEnd = parseTime(tRow[2]);
           if(currentTime > tEnd) cell.isPast = true;
           var tStart = parseTime(tRow[1]);
           if(currentTime >= tStart && currentTime < tEnd) cell.type = "LIVE"; // Temporary Type
        } else if (new Date(reqDateStr) < today) {
           cell.isPast = true; // All past if date is old
        }

        var colIdx = classSlotMap[slotName];
        if (colIdx !== undefined) {
          var rawVal = String(row[colIdx]).trim();
          
          // 1. Regular Data Parsing
          if(rawVal && rawVal !== "-") {
            if(rawVal.includes("/")) {
              cell.type = (cell.type === "LIVE") ? "LIVE" : "SPLIT";
              cell.text = "Optional/Split";
              cell.subText = "Multiple Faculty";
              cell.tooltip = rawVal; // Show full info on hover
            } else {
              cell.type = (cell.type === "LIVE") ? "LIVE" : "REGULAR";
              // Parse "Subject [ID] Teacher"
              var parts = rawVal.match(/^(.*?)\s*\[.*?\]\s*(.*)$/);
              if(parts) {
                cell.text = parts[1]; // Subject
                cell.subText = parts[2]; // Teacher
                cell.tooltip = `Teacher: ${parts[2]}`;
              } else {
                cell.text = rawVal;
                cell.tooltip = rawVal;
              }
            }
          }

          // 2. Substitution Override
          // Log Col B (Slot) and Col C (Class)
          var subEntry = dayLogs.find(s => String(s[1]) === slotName && String(s[2]) === classId);
          if(subEntry) {
             cell.type = (cell.type === "LIVE") ? "LIVE" : "SUB"; // Live status priority
             cell.isSub = true; // Flag for styling
             cell.text = subEntry[5]; // Substitute Name (Col F)
             cell.subText = "(Arrangement)";
             cell.tooltip = `Regular teacher ${subEntry[3]} is absent.`;
          }
        }
        rowPeriods.push(cell);
      }
      return { id: classId, meta: [], periods: rowPeriods };
    });
  }

  // ======================================================
  // 🅱️ TEACHER VIEW LOGIC (Read from Teacher_wiseTT)
  // ======================================================
  else {
    var sheet = ss.getSheetByName("Teacher_wiseTT");
    var allData = sheet.getRange(5, 1, sheet.getLastRow()-4, 14).getValues();
    var dayRows = allData.filter(r => String(r[4]).toUpperCase() === dayName);

    matrix = dayRows.map(row => {
      var empName = row[1];
      var empId = row[0];
      var rowPeriods = [];

      for(var i=0; i<timeData.length; i++) {
        var tRow = timeData[i];
        var slotName = String(tRow[0]).trim().toUpperCase();
        var type = String(tRow[4]).trim().toUpperCase();

        if (type === 'BREAK') continue;

        var cell = { slot: slotName, type: "FREE", text: "-", subText: "", tooltip: "", isPast: false };

        if(isToday) {
           var tEnd = parseTime(tRow[2]);
           if(currentTime > tEnd) cell.isPast = true;
           var tStart = parseTime(tRow[1]);
           if(currentTime >= tStart && currentTime < tEnd) cell.type = "LIVE";
        } else if (new Date(reqDateStr) < today) cell.isPast = true;

        var colIdx = teacherSlotMap[slotName];
        if (colIdx !== undefined) {
          var rawVal = String(row[colIdx]).trim();
          
          // 1. Regular Data
          if(rawVal && rawVal !== "-" && rawVal !== "OFF") {
             cell.type = (cell.type === "LIVE") ? "LIVE" : "REGULAR";
             cell.text = rawVal; // Class Name
             cell.subText = "Regular Class";
          }

          // 2. Substitution Check (Dual Check)
          
          // Case A: I am Absent (Log Col D = Name)
          var absentLog = dayLogs.find(s => String(s[1]) === slotName && String(s[3]) === empName);
          if(absentLog) {
             cell.type = "ABSENT"; // Red Override
             cell.text = "LEAVE";
             cell.subText = "Sub: " + absentLog[5];
             cell.tooltip = `Class ${absentLog[2]} taken by ${absentLog[5]}`;
          }

          // Case B: I am Substitute (Log Col F = Name)
          var subLog = dayLogs.find(s => String(s[1]) === slotName && String(s[5]) === empName);
          if(subLog) {
             cell.type = (cell.type === "LIVE") ? "LIVE" : "SUB";
             cell.isSub = true;
             cell.text = subLog[2]; // Class Name
             cell.subText = "Arrangement";
             cell.tooltip = `Covering for ${subLog[3]}`;
          }
        }
        rowPeriods.push(cell);
      }
      return { id: empName, meta: [row[2], row[3]], periods: rowPeriods };
    });
  }
  
  // Extract Header Names from TimeData for Frontend
  var headerSlots = timeData.filter(r => String(r[4]).toUpperCase() !== 'BREAK').map(r => r[0]);

  return ContentService.createTextOutput(JSON.stringify({
    status: true,
    data: matrix,
    headers: headerSlots,
    meta: { day: dayName, isLive: isToday }
  })).setMimeType(ContentService.MimeType.JSON);
}



// Helper to parse "Maths [101] Sharma" or "Phy/Chem [1/2] A/B"
function parseClassCell(text) {
  if (text.includes("/")) {
     // Handle Split Class simply for display
     return { subject: text, teacher: "Multiple Faculty" };
  }
  // Regex to extract Subject and Teacher, ignoring ID in brackets
  // Pattern: "Subject [ID] Teacher"
  var match = text.match(/^(.*?)\s*\[.*?\]\s*(.*)$/);
  if (match) {
    return { subject: match[1].trim(), teacher: match[2].trim() };
  }
  return { subject: text, teacher: "" };
}


// --- HELPER: Parse Time ---
function parseTime(timeVal) {
  if (!timeVal) return -1;
  var d = new Date(timeVal);
  if (isNaN(d.getTime())) return -1; 
  return d.getHours() * 60 + d.getMinutes();
}

// --- HELPER: Format Time ---
function formatTime(timeVal) {
  if (!timeVal) return "";
  var d = new Date(timeVal);
  if (isNaN(d.getTime())) return "";
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "hh:mm a");
}

/**
 * 📦 MASTER DATA FETCHER (FINAL + TIMINGS)
 * Returns: Teachers, Absentees, TeacherTT, ClassTT, Logs, TIMINGS
 */
function getArrangementMasterData(dateStr) {
  try {
    var ss5 = getDB5(); // Time Table DB

    // 1. TEACHER PROFILES
    var allTeachers = fetchTeachers(); 

    // 2. ABSENT LIST
    var absentIds = getAbsentTeachersList(dateStr);

    // 3. TEACHER TIME TABLE
    var tSheet = ss5.getSheetByName("Teacher_wiseTT");
    var teacherTT = tSheet.getRange(5, 1, tSheet.getLastRow() - 4, 14).getValues();

    // 4. CLASS TIME TABLE
    var cSheet = ss5.getSheetByName("Class_wiseTT");
    var classTT = cSheet.getRange(5, 1, cSheet.getLastRow() - 4, 11).getValues();

    // 🟢 5. PERIOD TIMINGS (For Live Green Status) - NEW ADDED
    var timeSheet = ss5.getSheetByName("Period_Timings");
    // Row 5 se data: [SlotName, StartTime, EndTime, Duration, Type]
    var timings = timeSheet.getRange(5, 1, timeSheet.getLastRow() - 4, 5).getValues();

    // 6. SUBSTITUTION LOGS (For Orange Status)
    var logSheet = ss5.getSheetByName("Substitution_Logs");
    var todayLogs = [];
    
    if (logSheet && logSheet.getLastRow() > 5) {
       var rawLogs = logSheet.getRange(6, 1, logSheet.getLastRow() - 5, 11).getValues();
       todayLogs = rawLogs.filter(function(r) {
          try {
             var logDate = Utilities.formatDate(new Date(r[0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
             return logDate === dateStr;
          } catch(e) { return false; }
       });
    }

    return {
      success: true,
      data: {
        teachers: allTeachers, 
        absentees: absentIds,  
        teacherTT: teacherTT,  
        classTT: classTT,      
        timings: timings,     // 🟢 Frontend iska use karke 'Live' check karega
        logs: todayLogs        
      }
    };

  } catch (e) {
    return { success: false, message: "Data Fetch Error: " + e.toString() };
  }
}

//=============================================================================================================================================================================================================/
// ===========================================================================================
//  TEST CONTROL CENTER — BACKEND CORE FUNCTIONS
// ===========================================================================================
const TEST_REGISTRY_SHEET = "Test_Registry";

const TR = {
  TESTID: 0, CLASS: 1, SECTION: 2, SUBJECT: 3, CHNO: 4, CHNAME: 5, TESTNAME: 6,
  DURATION: 7, STATUS: 8, RESVIS: 9, QCOUNT: 10, CREATEDBY: 11, CREATEDAT: 12, PUBLISHEDAT: 13
};

function getTestRegistrySheet() {
  var ss = getDB2();
  var sh = ss.getSheetByName(TEST_REGISTRY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TEST_REGISTRY_SHEET);
    sh.appendRow(["TestID", "Class", "Section", "Subject", "ChapterNo", "ChapterName", "TestName", "Duration", "Status", "ResultVisibility", "QuestionCount", "CreatedBy", "CreatedAt", "PublishedAt"]);
    sh.getRange(1, 1, 1, 14).setFontWeight("bold").setBackground("#eef2ff");
    sh.setFrozenRows(1);
  }
  return sh;
}

function readTestRegistry() {
  var sh = getTestRegistrySheet();
  var lastR = sh.getLastRow();
  var lastC = sh.getLastColumn(); // 🟢 Dynamic column detection
  
  if (lastR < 2) return [];
  if (lastC < 14) lastC = 16; // Failsafe minimum
  
  // 🟢 Safely read only existing physical columns to prevent 'Out of bounds'
  var data = sh.getRange(2, 1, lastR - 1, lastC).getValues(); 
  var list = [];
  
  for (var i = 0; i < data.length; i++) {
    if (!data[i][0]) continue; 
    list.push({
      testId: String(data[i][0]).trim(), 
      classVal: String(data[i][1] || "").trim(),
      section: String(data[i][2] || "ALL").trim().toUpperCase(), 
      subject: String(data[i][3] || "").trim(),
      chapterNo: data[i][4], 
      chapterName: String(data[i][5] || "").trim(), 
      testName: String(data[i][6] || "").trim(),
      duration: data[i][7], 
      status: String(data[i][8] || "DRAFT").trim().toUpperCase(),
      resultVisibility: String(data[i][9] || "IMMEDIATE").trim().toUpperCase(), 
      questionCount: data[i][10],
      createdBy: data[i][11], 
      createdAt: data[i][12], 
      publishedAt: data[i][13], 
      visibleTo: String(data[i][14] || "ALL").trim(), 
      // 🟢 Safe fallback if Column 16 doesn't exist yet
      schoolId: String(data[i][15] || "DEFAULT").trim(), 
      _row: i + 2
    });
  }
  return list;
}



function findRegistryRow(sh, testId) {
  var lastR = sh.getLastRow();
  if (lastR < 2) return -1;
  var ids = sh.getRange(2, 1, lastR - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) { if (String(ids[i][0]).trim() === String(testId).trim()) return i + 2; }
  return -1;
}

function registerTestFromRows(rows, meta) {
  try {
    if (!rows || rows.length === 0) return;
    var first = rows[0];
    var testId = String(first[0]).trim();
    var section = (meta && meta.section) ? String(meta.section).trim().toUpperCase() : "ALL";
    var schoolId = (meta && meta.schoolId) ? meta.schoolId : "DEFAULT"; // 🔴 SaaS ID

    var sh = getTestRegistrySheet();
    var existingRow = findRegistryRow(sh, testId);
    if (existingRow === -1) {
      // 🔴 16 Columns: Index 14 = VisibleTo, Index 15 = schoolId
      sh.appendRow([testId, String(first[1]).trim(), section, String(first[2]).trim(), first[3], String(first[4]).trim(), String(first[5]).trim(), first[6], "DRAFT", "IMMEDIATE", rows.length, (meta && meta.createdBy) ? meta.createdBy : "Admin", new Date(), "", "ALL", schoolId]);
    } else {
      sh.getRange(existingRow, 11).setValue(rows.length);
    }
  } catch (e) {}
}
 

function getTestRegistryWithStats(schoolId) {
  var registry = readTestRegistry();
  var qbSheet = getDB2().getSheetByName("QuestionBank");
  var qCountMap = {}, qMetaMap = {};
  
  if (qbSheet && qbSheet.getLastRow() > 1) {
    var qData = qbSheet.getRange(2, 1, qbSheet.getLastRow() - 1, 7).getValues();
    qData.forEach(function(r) {
      var tid = String(r[0]).trim();
      if (!tid) return;
      qCountMap[tid] = (qCountMap[tid] || 0) + 1;
      if (!qMetaMap[tid]) qMetaMap[tid] = { classVal: String(r[1]).trim(), subject: String(r[2]).trim(), chapterNo: r[3], chapterName: String(r[4]).trim(), testName: String(r[5]).trim(), duration: r[6] };
    });
  }
  
  var respSheet = getDB2().getSheetByName("Responses");
  var attemptMap = {};
  if (respSheet && respSheet.getLastRow() > 1) {
    var rData = respSheet.getRange(2, 1, respSheet.getLastRow() - 1, 17).getValues();
    rData.forEach(function(r) {
      var tid = String(r[16] || "").trim();
      if (tid) {
        if (!attemptMap[tid]) attemptMap[tid] = { count: 0, totalScore: 0 };
        attemptMap[tid].count++; attemptMap[tid].totalScore += (parseFloat(r[10]) || 0);
      }
    });
  }
  
  var registryByTestId = {};
  registry.forEach(function(r) { registryByTestId[r.testId] = r; });
  var allTestIds = Object.keys(qCountMap);
  registry.forEach(function(r) { if (allTestIds.indexOf(r.testId) === -1) allTestIds.push(r.testId); });

  var output = allTestIds.map(function(tid) {
    var reg = registryByTestId[tid], meta = qMetaMap[tid] || {}, att = attemptMap[tid] || { count: 0, totalScore: 0 };
    return {
      testId: tid, classVal: (reg && reg.classVal) || meta.classVal || "", section: (reg && reg.section) || "ALL",
      subject: (reg && reg.subject) || meta.subject || "", chapterNo: (reg && reg.chapterNo) || meta.chapterNo || "",
      chapterName: (reg && reg.chapterName) || meta.chapterName || "", testName: (reg && reg.testName) || meta.testName || "",
      duration: (reg && reg.duration) || meta.duration || "", status: (reg && reg.status) || "DRAFT",
      resultVisibility: (reg && reg.resultVisibility) || "IMMEDIATE",
      visibleTo: (reg && reg.visibleTo) || "ALL",
      questionCount: qCountMap[tid] || (reg ? reg.questionCount : 0) || 0,
      attemptCount: att.count, avgScore: att.count > 0 ? Math.round((att.totalScore / att.count) * 10) / 10 : 0,
      _isRegistered: !!reg, createdAt: reg ? reg.createdAt : "",
      schoolId: reg ? reg.schoolId : "DEFAULT" 
    };
  });
  
  output.forEach(function(o) {
    if (!o._isRegistered && o.questionCount > 0) {
      try { getTestRegistrySheet().appendRow([o.testId, o.classVal, "ALL", o.subject, o.chapterNo, o.chapterName, o.testName, o.duration, "DRAFT", "IMMEDIATE", o.questionCount, "Legacy", new Date(), "", "ALL", "DEFAULT"]); o.status = "DRAFT"; } catch (e) {}
    }
  });

  // Sort By Date (Old double sort bug removed)
  output.sort(function(a, b) { return (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0); });
  
  // 🔴 SaaS FILTER: Only send current school's tests
  if (schoolId && schoolId !== "DEFAULT") {
     output = output.filter(function(o) { return o.schoolId === schoolId; });
  }
  
  return output;
}


function updateTestStatus(testId, status) {
  var sh = getTestRegistrySheet(), row = findRegistryRow(sh, testId);
  if (row !== -1) { sh.getRange(row, 9).setValue(String(status).toUpperCase()); if (status === "PUBLISHED") sh.getRange(row, 14).setValue(new Date()); }
  return { success: true, message: "Status updated" };
}

function updateTestMeta(p) {
  var sh = getTestRegistrySheet(), row = findRegistryRow(sh, p.testId);
  if (row === -1) return { success: false, message: "Not found" };
  
  if (p.classVal) sh.getRange(row, 2).setValue(String(p.classVal).trim());
  if (p.section) sh.getRange(row, 3).setValue(String(p.section).toUpperCase());
  if (p.resultVisibility) sh.getRange(row, 10).setValue(String(p.resultVisibility).toUpperCase());
  
  // 🟢 NEW: Save Visibility Access String in Column O (15)
  if (p.visibleTo !== undefined) {
    sh.getRange(row, 15).setValue(String(p.visibleTo).toUpperCase().trim());
  }
  
  if (p.duration) {
    sh.getRange(row, 8).setValue(p.duration);
    var qb = getDB2().getSheetByName("QuestionBank");
    if (qb && qb.getLastRow() > 1) {
      var ids = qb.getRange(2, 1, qb.getLastRow() - 1, 1).getValues(), durCol = qb.getRange(2, 7, qb.getLastRow() - 1, 1), durVals = durCol.getValues();
      for (var i = 0; i < ids.length; i++) { if (String(ids[i][0]).trim() === String(p.testId).trim()) durVals[i][0] = p.duration; }
      durCol.setValues(durVals);
    }
  }
  return { success: true, message: "Meta updated" };
}


function deleteTestCompletely(testId) {
  var qb = getDB2().getSheetByName("QuestionBank");
  if (qb && qb.getLastRow() > 1) {
    var ids = qb.getRange(2, 1, qb.getLastRow() - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) { if (String(ids[i][0]).trim() === String(testId).trim()) qb.deleteRow(i + 2); }
  }
  var sh = getTestRegistrySheet(), row = findRegistryRow(sh, testId);
  if (row !== -1) sh.deleteRow(row);
  return { success: true, message: "Test Deleted" };
}

// ---------------------------------------------------------------------------
// 6. GET ATTEMPTS FOR A SPECIFIC TEST (from Responses)
// ---------------------------------------------------------------------------
function getTestAttemptsList(testId, schoolId) {
  var sh = getDB2().getSheetByName("Responses");
  if (!sh || sh.getLastRow() < 2) return [];
  
  // 🔴 Read 22 columns to include school_id
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 22).getValues();
  var out = [];
  
  for (var i = 0; i < data.length; i++) {
    var rowSchoolId = String(data[i][21] || "DEFAULT").trim();
    if (String(data[i][16] || "").trim() === String(testId).trim()) {
      
      // 🔴 SaaS Isolation Check
      if (schoolId && schoolId !== "DEFAULT" && rowSchoolId !== schoolId) continue;

      out.push({ 
        _row: i + 2, uid: data[i][0], name: data[i][1], chapterName: data[i][3],
        testName: data[i][4], timestamp: data[i][5], total: data[i][6], correct: data[i][7],
        incorrect: data[i][8], score: data[i][10], timeTaken: data[i][14],
        className: data[i][15], testId: data[i][16], userChoices: data[i][17],
        totalTimeGiven: data[i][18], timeSpent: data[i][19] || "[]", proctorUrl: data[i][20] || ""
      });
    }
  }
  return out.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}


function deleteResultEntry(p) {
  var sh = getDB2().getSheetByName("Responses");
  if (!sh || !p.row || p.row < 2) return { success: false, message: "Invalid" };
  sh.deleteRow(p.row);
  return { success: true, message: "Result entry deleted" };
}

// ============================================================================
// 📁 DB8: DAILY ACADEMIC & ADMINISTRATIVE LOGS
// ============================================================================

function saveTeacherDailyLog(params) {
  try {
    var db8 = getDB8();
    var sheet = db8.getSheetByName("Daily_Logs");
    
    // Auto-create sheet and headers if missing
    if (!sheet) {
      sheet = db8.insertSheet("Daily_Logs");
      sheet.appendRow([
        "Log_Date", "UID", "Teacher_Name", "Period", "Class", "Section", 
        "Period_Type", "Topic_Covered", "Objective", "Teaching_Method", 
        "Engagement_Status", "Outcome_Remarks", "Timestamp"
      ]);
      sheet.getRange(1, 1, 1, 13).setFontWeight("bold").setBackground("#1e3a8a").setFontColor("white");
      sheet.setFrozenRows(1);
    }

    var payload = JSON.parse(params.payload);
    if (!payload || payload.length === 0) return { success: false, message: "No data to save." };

    var timestamp = new Date();
    
    // Map JSON to Rows
    var rows = payload.map(function(r) {
      return [
        r.date, r.uid, r.teacherName, r.period, r.classVal, r.section,
        r.periodType, r.topic, r.objective, r.method, 
        r.engagement, r.remarks, timestamp
      ];
    });

    // Fast Bulk Write
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

    return { success: true, message: rows.length + " Periods logged successfully!" };
  } catch (e) {
    return { success: false, message: "DB8 Error: " + e.message };
  }
}

function getTeacherDailyLogs(uid, month) {
  try {
    var sheet = getDB8().getSheetByName("Daily_Logs");
    if (!sheet) return { success: true, data: [] };
    
    var data = sheet.getDataRange().getValues();
    var logs = [];
    
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === String(uid).trim()) {
        logs.push({
          date: data[i][0], period: data[i][3], classVal: data[i][4], section: data[i][5],
          periodType: data[i][6], topic: data[i][7], objective: data[i][8],
          method: data[i][9], engagement: data[i][10], remarks: data[i][11]
        });
      }
    }
    // Sort Newest First
    logs.sort((a,b) => new Date(b.date) - new Date(a.date));
    return { success: true, data: logs };
  } catch (e) {
    return { success: false, message: "Read Error: " + e.message };
  }
} 




 


