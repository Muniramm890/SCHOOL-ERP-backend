<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=12,20,24&height=200&section=header&text=School%20Office%20Backend&fontSize=44&fontColor=ffffff&fontAlignY=38&desc=Node.js%20%C2%B7%20Express%20%C2%B7%20Azure%20SQL%20REST%20API&descSize=18&descAlignY=58&animation=fadeIn" alt="School Office Backend banner" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A5%2018-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/Azure%20SQL-mssql-0078D4?style=for-the-badge&logo=microsoftsqlserver&logoColor=white" />
  <img src="https://img.shields.io/badge/Auth-JWT-E8600A?style=for-the-badge&logo=jsonwebtokens&logoColor=white" />
  <a href="https://www.schooloffice.tech"><img src="https://img.shields.io/badge/Product-School%20Office-1E2E52?style=for-the-badge" /></a>
</p>

## 🏫 About

This is the backend of **[School Office](https://www.schooloffice.tech)**, a school management ERP for K-12 schools. It is a REST API built with **Node.js and Express** on top of **Azure SQL (SQL Server)**. It handles authentication, school data, fee payments, document generation, email, file storage, scheduled jobs and parent communication through a WhatsApp API.

The admin panel that talks to this API lives in **[schoolOfficeAdminFront](https://github.com/Muniramm890/schoolOfficeAdminFront)**.

## 🧱 Architecture

```mermaid
flowchart LR
    A["🖥️ Admin panel<br/>React + TypeScript"] -->|HTTPS / JSON| B
    W["🌐 School Office website"] -.-> B

    subgraph B["⚙️ Express API (Node.js ≥ 18)"]
        direction TB
        S1["🔐 Security<br/>helmet · cors · rate limit"]
        S2["🪪 Auth<br/>JWT · bcrypt"]
        S3["✅ Validation<br/>express-validator"]
        S4["📝 Logging<br/>morgan · winston"]
        S5["⏰ Scheduled jobs<br/>node-cron"]
    end

    B --> D[("🗄️ Azure SQL<br/>mssql")]
    B --> P["💳 Razorpay<br/>fee payments"]
    B --> M["✉️ SendGrid<br/>email"]
    B --> F["🗂️ Cloudinary · Azure Blob<br/>file storage"]
    B --> G["📄 PDFKit<br/>receipts and documents"]
    B --> WA["📲 WhatsApp API<br/>parent communication"]
```

## 🧰 Tech stack

| Layer | Technology | Used for |
| :-- | :-- | :-- |
| Runtime | Node.js ≥ 18 | Server runtime |
| Framework | Express 4 | REST API, routing |
| Database | Azure SQL via `mssql` | Primary data store |
| Auth | `jsonwebtoken`, `bcryptjs` | Token auth and password hashing |
| Security | `helmet`, `cors`, `express-rate-limit` | Secure headers, CORS, rate limiting |
| Validation | `express-validator` | Request validation |
| Payments | `razorpay` | Fee collection |
| Documents | `pdfkit` | PDF generation |
| Email | `@sendgrid/mail` | Transactional email |
| Files | `multer`, `cloudinary`, `@azure/storage-blob` | Uploads and storage |
| Jobs | `node-cron` | Scheduled tasks |
| Logging | `morgan`, `winston` | HTTP and application logs |
| Utilities | `dotenv`, `uuid`, `compression` | Config, IDs, response compression |

### 📊 Dependencies by purpose

```mermaid
pie showData title 20 runtime dependencies
    "Security and validation" : 6
    "Integrations and files" : 6
    "Core and database" : 4
    "Logging and utilities" : 4
```

## 📁 Project structure

```text
SCHOOL-ERP-backend/
├── .github/
│   └── workflows/        # GitHub Actions workflows
├── src/
│   ├── server.js         # Application entry point
│   ├── utils/
│   │   └── migrate.js    # Database migration script (npm run migrate)
│   └── …                 # Remaining application source
├── .gitignore
├── package.json          # Scripts and dependencies
└── web.config            # IIS / Azure App Service (Windows) configuration
```

## 🚀 Getting started

**Requirements:** Node.js 18 or newer, and access to an Azure SQL / SQL Server database.

```bash
# 1. Clone
git clone https://github.com/Muniramm890/SCHOOL-ERP-backend.git
cd SCHOOL-ERP-backend

# 2. Install dependencies
npm install

# 3. Create a .env file with your configuration (loaded with dotenv)

# 4. Run database migrations
npm run migrate

# 5. Start the server
npm run dev     # development, auto-reload with nodemon
npm start       # production
```

| Script | What it does |
| :-- | :-- |
| `npm run dev` | Runs `src/server.js` with nodemon |
| `npm start` | Runs `src/server.js` with Node |
| `npm run migrate` | Runs `src/utils/migrate.js` |

## 🔒 Configuration and security

- Secrets such as database credentials, JWT secret and API keys are kept in a `.env` file, which is listed in `.gitignore` and never committed.
- The API uses secure HTTP headers, CORS rules and rate limiting, passwords are hashed with bcrypt, and requests are validated before they reach the database.

## 🔗 Related repositories

| Repository | Purpose |
| :-- | :-- |
| [schoolOfficeAdminFront](https://github.com/Muniramm890/schoolOfficeAdminFront) | React + TypeScript admin panel |
| [SchoolOffice](https://github.com/Muniramm890/SchoolOffice) | Product website |

## 📬 Contact

- 🌐 Website: [schooloffice.tech](https://www.schooloffice.tech)
- 📧 Email: [Head@schooloffice.tech](mailto:Head@schooloffice.tech)
- 👤 Developer: [Muni Ram Meena](https://github.com/Muniramm890)

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=12,20,24&height=100&section=footer" alt="footer" />
</p>
