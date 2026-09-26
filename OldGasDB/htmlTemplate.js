function generateAttractiveReceiptHtml(p, config, finalId, fileUrl, studentProfile, isPdf) {
  // PDF ke liye Base64, Email ke liye URL
  const logoSrc = isPdf ? getBase64FromDrive(config.logo) : config.logo;
  const photoSrc = isPdf ? getBase64FromDrive(studentProfile.photo) : studentProfile.photo;
  const watermarkSrc = isPdf ? getBase64FromDrive(config.watermark) : config.watermark;

  // Background for Watermark
  const bgStyle = watermarkSrc 
    ? `background-image: url('${watermarkSrc}'); background-repeat: no-repeat; background-position: center; background-size: 60%;` 
    : `background-color: #ffffff;`;

  // Current Date for Receipt
  const currentDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; ${bgStyle} box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
    <div style="background-color: rgba(255, 255, 255, 0.95); padding: 35px;">
      
      <div style="text-align: center; border-bottom: 2px dashed #cbd5e1; padding-bottom: 15px; margin-bottom: 20px;">
        ${logoSrc ? `<img src="${logoSrc}" style="height: 65px; margin-bottom: 8px; border-radius: 4px;">` : ''}
        <h1 style="margin: 0; font-size: 22px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">${config.schoolName}</h1>
        <p style="font-size: 12px; margin: 5px 0 0; color: #475569;">${config.address}</p>
      </div>

      <table style="width: 100%; margin-bottom: 20px;">
        <tr>
          <td style="width: 50%; vertical-align: top;">
            <span style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold;">Receipt No</span><br>
            <span style="font-size: 15px; font-weight: 700; color: #1e293b;">${finalId}</span>
          </td>
          <td style="width: 50%; text-align: right; vertical-align: top;">
            <span style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold;">Date</span><br>
            <span style="font-size: 14px; font-weight: 600; color: #1e293b;">${currentDate}</span>
          </td>
        </tr>
      </table>

      <table style="width: 100%; margin-bottom: 25px; background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 15px;">
        <tr>
          <td style="width: 75%; vertical-align: top;">
            <table style="width: 100%; font-size: 13px; line-height: 1.8;">
              <tr><td style="color: #64748b; width: 35%;">Student Name:</td><td style="font-weight: 600; color: #0f172a;">${p.name}</td></tr>
              <tr><td style="color: #64748b;">Father's Name:</td><td style="font-weight: 600; color: #334155;">${studentProfile.father || '--'}</td></tr>
              <tr><td style="color: #64748b;">Class & Roll:</td><td style="font-weight: 600; color: #334155;">${p.classVal} | Roll: ${studentProfile.roll || '--'}</td></tr>
              <tr><td style="color: #64748b;">Fee Month:</td><td style="font-weight: 600; color: #334155;">${p.month}</td></tr>
            </table>
          </td>
          <td style="width: 25%; text-align: right; vertical-align: middle;">
            <div style="width: 80px; height: 95px; border: 2px solid #e2e8f0; border-radius: 6px; overflow: hidden; background: #fff; display: inline-block;">
              ${photoSrc ? `<img src="${photoSrc}" style="width: 100%; height: 100%; object-fit: cover;">` : ''}
            </div>
          </td>
        </tr>
      </table>

      <div style="margin-bottom: 25px;">
        <h3 style="font-size: 12px; color: #475569; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 10px;">Transaction Details</h3>
        <table style="width: 100%; font-size: 13px; line-height: 1.8;">
          <tr>
            <td style="color: #64748b; width: 35%;">Payment Mode:</td>
            <td style="font-weight: 700; color: #0f172a;">${p.mode || 'CASH'}</td>
          </tr>
          <tr>
            <td style="color: #64748b;">Transaction ID:</td>
            <td style="font-weight: 600; color: #0f172a; font-family: monospace; font-size: 14px;">${p.trxId || 'N/A'}</td>
          </tr>
          <tr>
            <td style="color: #64748b;">Status:</td>
            <td style="font-weight: bold; color: #16a34a;">✅ SUCCESS</td>
          </tr>
        </table>
      </div>

      <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #bbf7d0; padding: 20px; border-radius: 10px; text-align: center;">
        <span style="font-size: 12px; color: #166534; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Total Received</span><br>
        <span style="font-size: 32px; font-weight: 900; color: #15803d; display: block; margin-top: 5px;">₹${parseFloat(p.amount).toLocaleString('en-IN')}</span>
      </div>

      <table style="width: 100%; margin-top: 30px; border-top: 1px solid #f1f5f9; padding-top: 15px;">
        <tr>
          <td style="font-size: 10px; color: #94a3b8; text-align: left;">
            Session 2025-26<br>
            ${fileUrl !== "#" ? `<a href="${fileUrl}" style="color: #4f46e5; text-decoration: none; font-weight: 600;">Download PDF</a>` : ''}
          </td>
          <td style="font-size: 10px; color: #94a3b8; text-align: right;">
            Authorized by: <strong style="color: #64748b;">${p.operator || 'SYSTEM'}</strong><br>
            <em>*Computer Generated Document</em>
          </td>
        </tr>
      </table>

    </div>
  </div>
  `;
}


/**
 * Drive ID se image fetch karke use Base64 string mein badalta hai
 * Taaki PDF generator usey access kar sake
 */
/**
 * 🟢 FIXED: Smart Drive ID & Base64 Converter
 * Ye full URL ya existing Base64 ko bhi handle karega
 */
function getBase64FromDrive(id) {
  if (!id || id === "" || id === "N/A") return "";
  
  // 1. Agar pehle se hi Base64 hai (data:image...), toh direct wapas kar do
  if (id.toString().startsWith("data:image")) {
    return id;
  }

  // 2. Agar poora Drive URL hai, toh usme se sirf ID nikalo
  var cleanId = id;
  if (id.indexOf("id=") !== -1) {
    cleanId = id.split("id=")[1].split("&")[0];
  } else if (id.indexOf("d/") !== -1) {
    cleanId = id.split("d/")[1].split("/")[0];
  }

  // 3. Ab fresh ID se image fetch karo
  try {
    const file = DriveApp.getFileById(cleanId.trim());
    const blob = file.getBlob();
    return "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    Logger.log("Image Fetch Error (ID: " + cleanId + "): " + e.toString());
    return ""; // Error aane par empty box dega, code crash nahi hoga
  }
}


function generateAttractiveSalaryHtml(p, config, finalId, fileUrl, staffProfile, isPdf) {
  // PDF ke liye Base64, Email ke liye URL (Same Logic)
  const logoSrc = isPdf ? getBase64FromDrive(config.logo) : config.logo;
  const photoSrc = isPdf ? getBase64FromDrive(staffProfile.photo) : staffProfile.photo;
  const watermarkSrc = isPdf ? getBase64FromDrive(config.watermark) : config.watermark;

  // Background for Watermark
  const bgStyle = watermarkSrc 
    ? `background-image: url('${watermarkSrc}'); background-repeat: no-repeat; background-position: center; background-size: 60%;` 
    : `background-color: #ffffff;`;

  // Current Date for Payslip
  const currentDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Safe Number Formatting
  const netPaid = parseFloat(p.amount) || 0;
  const deduction = parseFloat(p.deduction) || 0;
  const grossSalary = netPaid + deduction;

  return `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; ${bgStyle} box-shadow: 0 4px 15px rgba(0,0,0,0.08);">
    <div style="background-color: rgba(255, 255, 255, 0.95); padding: 35px;">
      
      <!-- HEADER -->
      <div style="text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 15px; margin-bottom: 20px;">
        ${logoSrc ? `<img src="${logoSrc}" style="height: 65px; margin-bottom: 8px; border-radius: 4px;">` : ''}
        <h1 style="margin: 0; font-size: 22px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">${config.schoolName}</h1>
        <p style="font-size: 12px; margin: 5px 0 0; color: #475569;">${config.address}</p>
        <div style="margin-top: 15px; display: inline-block; background: #1e3a8a; color: white; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; letter-spacing: 1px;">
          SALARY SLIP / VOUCHER - ${p.month.toUpperCase()}
        </div>
      </div>

      <!-- VOUCHER & DATE INFO -->
      <table style="width: 100%; margin-bottom: 20px;">
        <tr>
          <td style="width: 50%; vertical-align: top;">
            <span style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold;">Voucher No.</span><br>
            <span style="font-size: 15px; font-weight: 700; color: #1e293b;">${finalId}</span>
          </td>
          <td style="width: 50%; text-align: right; vertical-align: top;">
            <span style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold;">Date Generated</span><br>
            <span style="font-size: 14px; font-weight: 600; color: #1e293b;">${currentDate}</span>
          </td>
        </tr>
      </table>

      <!-- EMPLOYEE DETAILS -->
      <table style="width: 100%; margin-bottom: 25px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px;">
        <tr>
          <td style="width: 75%; vertical-align: top;">
            <table style="width: 100%; font-size: 13px; line-height: 1.8;">
              <tr><td style="color: #64748b; width: 35%;">Employee Name:</td><td style="font-weight: 600; color: #0f172a;">${p.name}</td></tr>
              <tr><td style="color: #64748b;">Employee ID (UID):</td><td style="font-weight: 600; color: #334155;">${p.uid || '--'}</td></tr>
              <tr><td style="color: #64748b;">Designation:</td><td style="font-weight: 600; color: #334155;">${staffProfile.designation || 'Staff'}</td></tr>
              <tr><td style="color: #64748b;">Department:</td><td style="font-weight: 600; color: #334155;">${staffProfile.subject || 'General'}</td></tr>
            </table>
          </td>
          <td style="width: 25%; text-align: right; vertical-align: middle;">
            <div style="width: 80px; height: 95px; border: 2px solid #cbd5e1; border-radius: 6px; overflow: hidden; background: #fff; display: inline-block;">
              ${photoSrc ? `<img src="${photoSrc}" style="width: 100%; height: 100%; object-fit: cover;">` : '<div style="text-align:center; padding-top: 35px; color:#94a3b8; font-size: 10px;">No Photo</div>'}
            </div>
          </td>
        </tr>
      </table>

      <!-- SALARY COMPUTATION -->
      <div style="margin-bottom: 25px;">
        <h3 style="font-size: 12px; color: #475569; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 10px;">Salary Computation</h3>
        <table style="width: 100%; font-size: 13px; line-height: 2; border-collapse: collapse;">
          <tr style="border-bottom: 1px dashed #e2e8f0;">
            <td style="color: #475569; width: 60%;">Total / Gross Salary</td>
            <td style="font-weight: 600; color: #0f172a; text-align: right;">₹${grossSalary.toLocaleString('en-IN')}</td>
          </tr>
          <tr style="border-bottom: 1px dashed #e2e8f0;">
            <td style="color: #ef4444;">Less: Deductions (Leave/Advance)</td>
            <td style="font-weight: 600; color: #ef4444; text-align: right;">- ₹${deduction.toLocaleString('en-IN')}</td>
          </tr>
          <tr style="border-bottom: 1px dashed #e2e8f0;">
            <td style="color: #475569;">Payment Method</td>
            <td style="font-weight: 600; color: #0f172a; text-align: right;">${p.mode || 'BANK TRANSFER'}</td>
          </tr>
        </table>
      </div>

      <!-- NET PAYABLE BOX (Blue Theme) -->
      <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 1px solid #bfdbfe; padding: 20px; border-radius: 10px; text-align: center;">
        <span style="font-size: 12px; color: #1e40af; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Net Amount Paid</span><br>
        <span style="font-size: 32px; font-weight: 900; color: #1d4ed8; display: block; margin-top: 5px;">₹${netPaid.toLocaleString('en-IN')}</span>
      </div>

      <!-- FOOTER -->
      <table style="width: 100%; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
        <tr>
          <td style="font-size: 10px; color: #94a3b8; text-align: left;">
            Session 2025-26<br>
            ${fileUrl !== "#" ? `<a href="${fileUrl}" style="color: #2563eb; text-decoration: none; font-weight: 600;">Download Payslip (PDF)</a>` : ''}
          </td>
          <td style="font-size: 10px; color: #94a3b8; text-align: right;">
            Processed by: <strong style="color: #64748b;">${p.operator || 'SYSTEM ADMIN'}</strong><br>
            <em>*Computer Generated Payslip</em>
          </td>
        </tr>
      </table>

    </div>
  </div>
  `;
}

/**
 * Professional Absent Alert HTML Generator
 * Student Photo, Logo, aur Watermark ke saath
 */

function generateAttractiveAbsentHtml(studentProfile, config, date) {
  
  // 🚫 STRICT FIX: Removed getBase64FromDrive() to prevent Gmail size limit crash.
  // We only use the raw URL for the logo if it exists and is a valid HTTP link.
  var safeLogoUrl = (config.logo && config.logo.length < 300 && config.logo.startsWith("http")) ? config.logo : "";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; border: 1px solid #fee2e2; border-radius: 12px; background-color: #ffffff; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
      
      <div style="text-align: center; border-bottom: 2px solid #ef4444; padding: 20px; background-color: #fef2f2;">
        ${safeLogoUrl ? `<img src="${safeLogoUrl}" style="height: 50px; margin-bottom: 10px;">` : ''}
        <h1 style="margin: 0; font-size: 18px; color: #991b1b; text-transform: uppercase;">${config.schoolName || 'School Administration'}</h1>
        <p style="font-size: 11px; margin: 5px 0 0 0; color: #6b7280;">${config.address || ''}</p>
      </div>

      <div style="padding: 25px;">
        <div style="text-align: center; margin-bottom: 25px;">
           <span style="background: #ef4444; color: #ffffff; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: bold; letter-spacing: 1px;">ATTENDANCE ALERT</span>
        </div>

        <p style="color: #374151; font-size: 14px;">Dear Parent / Guardian,</p>
        <p style="color: #374151; font-size: 14px; line-height: 1.6;">This is to inform you that your ward is marked <strong style="color: #ef4444;">ABSENT</strong> from school today.</p>

        <table style="width: 100%; margin: 20px 0; border-collapse: collapse; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
          <tr>
            <td style="padding: 12px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #e5e7eb; width: 35%;">Student Name:</td>
            <td style="padding: 12px; font-weight: bold; color: #1f2937; border-bottom: 1px solid #e5e7eb;">${studentProfile.name || '--'}</td>
          </tr>
          <tr>
            <td style="padding: 12px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Class & Roll:</td>
            <td style="padding: 12px; color: #1f2937; border-bottom: 1px solid #e5e7eb;">${studentProfile.class || '--'} | ${studentProfile.roll || '--'}</td>
          </tr>
          <tr>
            <td style="padding: 12px; color: #6b7280; font-size: 13px;">Date:</td>
            <td style="padding: 12px; color: #ef4444; font-weight: bold;">${date}</td>
          </tr>
        </table>

        <div style="background: #fff5f5; border-left: 4px solid #ef4444; padding: 12px; color: #991b1b; font-size: 12px; line-height: 1.5;">
          <b>Important:</b> Regular attendance is essential for academic success. Kindly submit a leave application for this absence.
        </div>
      </div>

      <div style="text-align: center; font-size: 10px; color: #9ca3af; background-color: #f3f4f6; padding: 12px;">
        System Generated Alert | ${config.schoolName || 'Administration'}
      </div>
      
    </div>
  `;
}



/**
 * Professional Consolidated Substitution Email Template
 * Optimized for Watermark and Modern UI
 */
/**
 * Professional Consolidated Substitution Email Template
 * 🟢 UPDATED: Ab isme khud ka School Header aur Watermark include hai
 */
function generateConsolidatedEmailHtml(teacherName, tasks, config) {
  const primaryColor = "#4f46e5"; // Professional Indigo
  const accentColor = "#ef4444";  // Alert Red for Absent Teacher

  // 1. Images ko Base64 mein convert karna (PDF/Email mein direct dikhane ke liye)
  const logoBase64 = getBase64FromDrive(config.logo);
  const watermarkBase64 = getBase64FromDrive(config.watermark);

  // 2. Generate Duty Slots (Cards look)
  var taskHtml = tasks.map(t => `
    <div style="background-color: rgba(249, 250, 251, 0.7); border: 1px solid #e5e7eb; border-radius: 10px; padding: 15px; margin-bottom: 12px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="width: 25%; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Period</td>
          <td style="width: 35%; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Class</td>
          <td style="width: 40%; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Substituting For</td>
        </tr>
        <tr>
          <td style="font-size: 16px; font-weight: 800; color: ${primaryColor}; padding-top: 5px;">${t.slot}</td>
          <td style="font-size: 16px; font-weight: 700; color: #111827; padding-top: 5px;">${t.className}</td>
          <td style="font-size: 14px; font-weight: 500; color: ${accentColor}; padding-top: 5px;">${t.absentTeacher}</td>
        </tr>
      </table>
    </div>
  `).join('');

  // 3. Final HTML Wrapper (With Branding)
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; padding: 25px; border-radius: 15px; background-color: #ffffff; position: relative; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
      
      ${watermarkBase64 ? `
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); width: 400px; z-index: 0; opacity: 0.04; text-align: center;">
        <img src="${watermarkBase64}" style="width: 100%;">
      </div>` : ''}

      <div style="position: relative; z-index: 1;">
        
        <div style="text-align: center; border-bottom: 2px solid ${primaryColor}; padding-bottom: 10px; margin-bottom: 20px;">
          ${logoBase64 ? `<img src="${logoBase64}" style="height: 55px; margin-bottom: 5px;">` : ''}
          <h1 style="margin: 0; font-size: 18px; color: ${primaryColor}; text-transform: uppercase;">${config.schoolName}</h1>
          <p style="font-size: 10px; margin: 3px; color: #6b7280;">${config.address}</p>
        </div>

        <div style="text-align: center; margin-bottom: 20px;">
           <span style="background: #e0e7ff; color: #4338ca; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; border: 1px solid #c7d2fe;">SUBSTITUTION DUTY SCHEDULE</span>
        </div>

        <div style="padding: 10px 0;">
          <p style="font-size: 15px; color: #1e293b; margin-bottom: 10px;">
            Respected <b>${teacherName}</b>,
          </p>
          
          <p style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 25px;">
            Your cooperation helps us maintain a consistent learning experience for our students. 
            Please find your <b>substitution schedule</b> for today, <b>${tasks[0].date}</b>:
          </p>

          <div style="margin-bottom: 25px;">
            ${taskHtml}
          </div>

          <div style="border-left: 4px solid ${primaryColor}; background-color: rgba(79, 70, 229, 0.05); padding: 15px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 13px; color: #4338ca; line-height: 1.5;">
              <b>Note:</b> Kindly collect any pending assignments or lesson plans for these classes from the staff coordinator. Thank you for your support!
            </p>
          </div>

          <p style="font-size: 12px; color: #94a3b8; font-style: italic; text-align: center;">
            "Teachers affect eternity; no one can tell where their influence stops."
          </p>
        </div>

        <div style="text-align: center; font-size: 10px; color: #9ca3af; margin-top: 25px; border-top: 1px solid #f3f4f6; padding-top: 10px;">
          Issued by: Administration | ${config.schoolName}
        </div>

      </div>
    </div>
  `;
}
