/**
 * 🧪 DUMMY TESTER (FIXED)
 */

function testWhatsAppTemplate() {
  var myPhoneNumber = "919784849176"; 

  // 🟢 FIX: No New Lines (\n). Use Separators.
  var dummyList = "👉 P1: 10th-A  |  👉 P4: 12th-B  |  👉 P6: 9th-C"; 
  
  var config = getMasterConfig();

  Logger.log("🚀 Sending Clean Payload...");

  var isSent = sendSubstitutionWhatsApp(
    myPhoneNumber, 
    "TEST TEACHER", 
    "17 Jan 2026", 
    dummyList, 
    config.schoolName || "PM SHRI SCHOOL"
  );

  if (isSent) Logger.log("✅ SUCCESS! Check WhatsApp.");
  else Logger.log("❌ STILL FAILING. Run 'debugWhatsApp' again.");
}

function sendSubstitutionWhatsApp(phone, teacherName, date, listString, schoolName) {
  try {
    const config = getMasterConfig();
    if (!config || !config.token || !config.phoneId) return false;

    var cleanPhone = String(phone).replace(/\D/g, ''); 
    if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;

    const url = "https://graph.facebook.com/v18.0/" + config.phoneId + "/messages";
    
    // Ensure listString has NO newlines (Safety Check)
    var safeListString = String(listString).replace(/\n/g, "  |  ");

    const payload = {
      "messaging_product": "whatsapp",
      "to": cleanPhone,
      "type": "template",
      "template": {
        "name": "substitution_assignment_alert", 
        "language": { "code": "en" },
        "components": [
          {
            "type": "body",
            "parameters": [
              { "type": "text", "text": teacherName }, 
              { "type": "text", "text": date },        
              { "type": "text", "text": safeListString },  // ✅ SAFE STRING
              { "type": "text", "text": schoolName }   
            ]
          }
        ]
      }
    };

    const options = {
      "method": "post",
      "headers": { "Authorization": "Bearer " + config.token, "Content-Type": "application/json" },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    const res = UrlFetchApp.fetch(url, options);
    var responseCode = res.getResponseCode();
    
    if (responseCode !== 200) {
        Logger.log("WA API Error: " + res.getContentText());
    }
    return responseCode === 200;

  } catch (e) { 
    Logger.log("WA Script Error: " + e.toString());
    return false; 
  }
}

/**
 * 🟢 WhatsApp Fee Transaction Sender (Meta API)
 * Template: fee_submission_confirmation
 */
function sendWhatsAppFeeConfirmation(phone, studentName, amount, month, trxId, mode) {
  try {
    const config = getMasterConfig();
    
    // Config validation
    if (!config || !config.token || !config.phoneId) {
      Logger.log("❌ WhatsApp Config Missing");
      return false;
    }

    // Phone number sanitization (India code '91' add karna)
    var cleanPhone = String(phone).replace(/\D/g, ''); 
    if (cleanPhone.length === 10) { cleanPhone = "91" + cleanPhone; }

    // Timestamp format: "22 June 2026, 08:22 AM"
    var timeStr = Utilities.formatDate(new Date(), "GMT+5:30", "dd MMMM yyyy, hh:mm a");

    // Endpoint URL
    const url = "https://graph.facebook.com/v18.0/" + config.phoneId + "/messages";

    // Meta API JSON Payload (1 Header Var, 6 Body Vars)
    const payload = {
      "messaging_product": "whatsapp",
      "to": cleanPhone,
      "type": "template",
      "template": {
        "name": "fee_submission_confirmation", // Aapka exact template name
        "language": { "code": "en" },
        "components": [
          {
            "type": "header",
            "parameters": [
              { "type": "text", "text": config.schoolName } // Header {{1}} 
            ]
          },
          {
            "type": "body",
            "parameters": [
              { "type": "text", "text": studentName },                // Body {{1}}
              { "type": "text", "text": String(amount) },             // Body {{2}}
              { "type": "text", "text": month },                      // Body {{3}}
              { "type": "text", "text": String(trxId || "CASH") },    // Body {{4}}
              { "type": "text", "text": String(mode) },               // Body {{5}}
              { "type": "text", "text": timeStr }                     // Body {{6}}
            ]
          }
        ]
      }
    };

    const options = {
      "method": "post",
      "headers": {
        "Authorization": "Bearer " + config.token,
        "Content-Type": "application/json"
      },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    // API Call
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    
    if (response.getResponseCode() === 200) {
      Logger.log("✅ Fee WhatsApp Sent to: " + cleanPhone);
      return true;
    } else {
      Logger.log("❌ Meta Error: " + (result.error ? result.error.message : "Unknown"));
      return false;
    }
  } catch (e) {
    Logger.log("❌ WhatsApp Script Exception: " + e.toString());
    return false;
  }
}

function sendWhatsAppSalaryAlert(phone, staffName, month, amount, voucherId, mode) {
  try {
    const config = getMasterConfig();
    if (!config || !config.token || !config.phoneId) return false;

    var cleanPhone = String(phone).replace(/\D/g, ''); 
    if (cleanPhone.length === 10) { cleanPhone = "91" + cleanPhone; }

    const url = "https://graph.facebook.com/v18.0/" + config.phoneId + "/messages";

    const payload = {
      "messaging_product": "whatsapp",
      "to": cleanPhone,
      "type": "template",
      "template": {
        "name": "staff_salary_disbursement", // 👈 Naye template ka naam
        "language": { "code": "en" },
        "components": [
          {
            "type": "body",
            "parameters": [
              { "type": "text", "text": staffName },     // {{1}}
              { "type": "text", "text": month },         // {{2}}
              { "type": "text", "text": String(amount) },// {{3}}
              { "type": "text", "text": voucherId },     // {{4}}
              { "type": "text", "text": mode || "Bank" } // {{5}}
            ]
          }
        ]
      }
    };

    const options = {
      "method": "post",
      "headers": {
        "Authorization": "Bearer " + config.token,
        "Content-Type": "application/json"
      },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    const response = UrlFetchApp.fetch(url, options);
    return response.getResponseCode() === 200;
  } catch (e) {
    return false;
  }
}

/**
 * PROFESSIONAL SENDER: Using centralized Config Object
 */
function sendWhatsAppAbsentAlert(phone, studentName) {
  try {
    // 1. Config Object se data nikalna
    const config = getMasterConfig();
    
    if (!config || !config.token || !config.phoneId) {
      Logger.log("❌ Error: WhatsApp Config (Token/ID) missing in Sheet!");
      return false;
    }

    // 2. Formatting Date: 09 January 2026
    const formattedDate = Utilities.formatDate(new Date(), "GMT+5:30", "dd MMMM yyyy");

    // 3. Phone Sanitization
    var cleanPhone = String(phone).replace(/\D/g, ''); 
    if (cleanPhone.length === 10) { cleanPhone = "91" + cleanPhone; }

    const url = "https://graph.facebook.com/v18.0/" + config.phoneId + "/messages";

    // 4. Payload with 3 Variables
    const payload = {
      "messaging_product": "whatsapp",
      "to": cleanPhone,
      "type": "template",
      "template": {
        "name": "attendance_alert", 
        "language": { "code": "en" },
        "components": [
          {
            "type": "header",
            "parameters": [{ "type": "text", "text": config.schoolName }] // {{1}} Header from C10
          },
          {
            "type": "body",
            "parameters": [
              { "type": "text", "text": studentName },   // {{1}} Body
              { "type": "text", "text": formattedDate } // {{2}} Body
            ]
          }
        ]
      }
    };

    const options = {
      "method": "post",
      "headers": {
        "Authorization": "Bearer " + config.token,
        "Content-Type": "application/json"
      },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    
    if (response.getResponseCode() === 200) {
      Logger.log("✅ Alert Sent Successfully to: " + cleanPhone);
      return true;
    } else {
      Logger.log("❌ Meta Error: " + result.error.message);
      return false;
    }
  } catch (e) {
    Logger.log("❌ Script Exception: " + e.toString());
    return false;
  }
}

