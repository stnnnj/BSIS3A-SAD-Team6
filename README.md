
# CCMC RetailFlow

**Sales and Inventory Management System for CCMC RTW Shop**

A web-based retail management system designed to manage sales, reservations, returns, inventory, and store operations in a centralized platform.

**Live Website:** https://ccmc-retailflow.netlify.app/
owner and staff accounts displayed in the homepage

**GitHub Repository:** https://github.com/stnnnj/BSIS3A-SAD-Team6

**Database Link:** https://tidbcloud.com/tidbs/10416062767860575716/overview?orgId=1372813089209389333
invitation si sent through email as well

**Note:** Mobile view only shows selected modules only that display reports while Tablet view still consist fo the complete modules.

**Project Team:** Team 6 – BSIS 3A  
**University:** Technological University of the Philippines

---

# 📚 Table of Contents

- [About the Project](#about-the-project)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Demo Accounts](#demo-accounts)
- [User Roles & Permissions](#user-roles--permissions)
- [Usage Guide](#usage-guide)
- [API Overview](#api-overview)
- [Database Information](#database-information)
- [Deployment & Version Control](#deployment--version-control)
- [Testing](#testing)
- [Security & Limitations](#security--limitations)
- [Authors](#authors)
- [License](#license)

---

<a id="about-the-project"></a>

# 📖 About the Project

**CCMC RetailFlow** is a full-stack, web-based Sales and Inventory Management System developed for a single-branch ready-to-wear (RTW) clothing shop.

The system centralizes daily business operations, including sales transactions, product inventory, customer reservations, returns and refunds, supplier information, and financial reporting.

CCMC RetailFlow aims to improve transaction accuracy, inventory monitoring, and overall store management through an integrated digital platform.

The system implements **Role-Based Access Control (RBAC)** with dedicated dashboards and permissions for:

- **OWNER**
- **STAFF**

The Owner manages overall store operations, while Staff members handle daily sales, reservations, returns, and inventory monitoring.

This project was developed as part of the Systems Analysis and Design course. **Team 6 received the system analysis from Team 10 and handled both Phase 3 (System Design) and Phase 4 (Implementation).**

---

<a id="key-features"></a>

# ✨ Key Features

- Sales and Point of Sale (POS) Management
- Cash and GCash Payment Recording
- Product and Category Management
- Inventory Monitoring and Stock Adjustments
- Low Stock and Out-of-Stock Monitoring
- Customer Reservations
- Returns and Refunds Management
- Supplier Management
- Role-Based Access Control
- Owner and Staff Dashboards
- Financial Analytics
- Sales and Inventory Reports
- CSV Report Export
- User Account Management
- Stock Movement History
- Responsive Web Interface

**Payment Processing:** Cash and GCash transactions are recorded internally. GCash payments require manual confirmation and are not processed through an external payment gateway.

---

<a id="tech-stack"></a>

# 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | HTML5, CSS3, JavaScript, Bootstrap 5 |
| Backend | Python, Flask |
| Database | TiDB Cloud Starter, MySQL-Compatible |
| Database Driver | PyMySQL |
| Authentication | Flask Sessions, Password Hashing, RBAC |
| Frontend Hosting | Netlify Free |
| Backend Hosting | Render Free |
| Database Hosting | TiDB Cloud Starter |
| Testing | pytest, Postman, Manual Testing |
| Development Tools | Visual Studio Code, Git, GitHub, GitHub Desktop |
| Version Control | Git and GitHub |

---

<a id="system-architecture"></a>

# 🏗️ System Architecture

CCMC RetailFlow follows a three-layer web application architecture.

```text
             USER
        OWNER / STAFF
               |
               v
     PRESENTATION LAYER
       Frontend - Netlify
     HTML, CSS, JavaScript
          Bootstrap 5
               |
               | HTTPS / REST API
               v
      APPLICATION LAYER
        Backend - Render
         Python / Flask
     Authentication & APIs
               |
               | Database Connection
               v
          DATA LAYER
       TiDB Cloud Starter
       MySQL-Compatible
               |
               v
         SYSTEM RECORDS
      Users, Products, Sales,
      Reservations, Returns,
      Suppliers, Inventory
```

### Architecture Components

**Presentation Layer**

Provides the browser-based Owner and Staff interfaces using HTML, CSS, JavaScript, and Bootstrap 5.

**Application Layer**

Handles business logic, authentication, user permissions, transaction processing, and communication with the database through Flask APIs.

**Data Layer**

Stores and manages the system's relational data through TiDB Cloud Starter.

---

<a id="project-structure"></a>

# 🗂️ Project Structure

```text
BSIS3A-SAD-Team6/
|
|-- backend/
|   |-- app.py
|   |-- db.py
|   |-- sales.py
|   |-- reservations.py
|   |-- returns.py
|   |-- inventory.py
|   |-- products.py
|   |-- suppliers.py
|   |-- financial.py
|   |-- reports.py
|   |-- users.py
|   |-- owner_dashboard.py
|   |-- staff_dashboard.py
|   |-- requirements.txt
|
|-- frontend/
|   |-- index.html
|   |-- auth.js
|   |-- owner-dashboard.html
|   |-- staff-dashboard.html
|   |
|   |-- css/
|   |-- dashboard/
|   |-- sales/
|   |-- reservations/
|   |-- returns/
|   |-- inventory/
|   |-- products/
|   |-- suppliers/
|   |-- financial/
|   |-- reports/
|   |-- users/
|   |-- _redirects
|
|-- database/
|   |-- schema.sql
|
|-- tests/
|   |-- unit/
|   |-- integration/
|   |-- functional/
|
|-- docs/
|
|-- .gitignore
|-- README.md
```

The project uses a modular structure that separates frontend pages, Flask backend modules, database configuration, testing files, and documentation.

*Note: Verify the folder structure against the latest repository before publishing, as additional files may have been added during development.*

---

<a id="getting-started"></a>

# 🚀 Getting Started

## Prerequisites

Before running CCMC RetailFlow locally, install the following:

- Python 3.10 or later
- Git
- Visual Studio Code
- A configured MySQL-compatible database
- Access to the required database environment variables

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/stnnnj/BSIS3A-SAD-Team6.git
cd BSIS3A-SAD-Team6
```

### 2. Create a Virtual Environment

For Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. Install Dependencies

```powershell
python -m pip install -r backend/requirements.txt
```

### 4. Configure Environment Variables

Create a `.env` file containing the environment variables required by your local backend configuration.

Example:

```dotenv
FLASK_SECRET_KEY=your-development-secret-key
TIDB_HOST=your-database-host
TIDB_PORT=4000
TIDB_USER=your-database-username
TIDB_PASSWORD=your-database-password
TIDB_DATABASE=your-database-name
```

Use the actual environment variable names defined in the backend configuration.

**Important:** Do not upload real database credentials, secret keys, or `.env` files to GitHub.

### 5. Run the Flask Backend

```powershell
python backend/app.py
```

### 6. Open the Local Website

Open:

http://127.0.0.1:5000/frontend/index.html

The application requires the Flask backend and a valid database connection.

---

<a id="demo-accounts"></a>

# 🔑 Demo Accounts

The following accounts are provided for academic evaluation and system demonstration.

**Live Website:** https://ccmc-retailflow.netlify.app/

| Role | Username | Password |
|---|---|---|
| OWNER | Owner | password123 |
| STAFF | Staff | password123 |

### Login Instructions

1. Open the live website.
2. Select **Owner** or **Staff**.
3. Enter the corresponding username and password.
4. Click **Sign in**.
5. The system redirects the user to the appropriate dashboard.

**Security Note:** These credentials should only be published if they belong to isolated, disposable demonstration accounts. Otherwise, provide the passwords privately to the evaluator.

---

<a id="user-roles--permissions"></a>

# 👥 User Roles & Permissions

CCMC RetailFlow implements Role-Based Access Control to restrict system features according to the logged-in user's assigned role.

| Feature / Access | OWNER | STAFF |
|---|:---:|:---:|
| Login Authentication | ✅ | ✅ |
| Owner Dashboard | ✅ | ❌ |
| Staff Dashboard | ✅ | ✅ |
| Sales / POS | ✅ | ✅ |
| Cash Payment Recording | ✅ | ✅ |
| GCash Payment Recording | ✅ | ✅ |
| Reservations | ✅ | ✅ |
| Returns and Refunds | ✅ | ✅ |
| View Inventory | ✅ | ✅ |
| View Stock Movements | ✅ | ✅ |
| Manual Stock Adjustments | ✅ | ❌ |
| Manage Products | ✅ | ❌ |
| Manage Categories | ✅ | ❌ |
| Manage Suppliers | ✅ | ❌ |
| Financial Analytics | ✅ | ❌ |
| Generate Reports | ✅ | ❌ |
| Export Reports | ✅ | ❌ |
| User Account Management | ✅ | ❌ |
| Logout | ✅ | ✅ |

## Administrative Distinctions

**OWNER**

Has administrative access to store management functions, including products, suppliers, inventory adjustments, financial analytics, reports, and user accounts.

**STAFF**

Handles daily sales, reservations, returns, refunds, and inventory monitoring without access to administrative management features.

**Note:** CCMC RetailFlow does not provide customer registration or customer login accounts.

---

<a id="usage-guide"></a>

# 🧭 Usage Guide

## Staff Workflow

1. Log in using a Staff account.
2. Access the Staff Dashboard.
3. Open Sales / POS to create a transaction.
4. Select products and quantities.
5. Record Cash or GCash payment.
6. Complete the sale and view the receipt.
7. Manage customer reservations when needed.
8. Process eligible returns and refunds.
9. Monitor stock through the Inventory module.
10. Log out after completing operations.

## Owner Workflow

1. Log in using an Owner account.
2. Access the Owner Dashboard.
3. Review sales and inventory summaries.
4. Manage products, categories, and suppliers.
5. Monitor inventory and record stock adjustments.
6. Access Sales, Reservations, and Returns.
7. Review Financial Analytics.
8. Generate and export reports.
9. Manage Owner and Staff accounts.
10. Log out after completing administrative tasks.

## Inventory Workflow

1. Open the Inventory module.
2. View available stock quantities.
3. Search or filter products.
4. Review low-stock and out-of-stock items.
5. For Owner accounts, record Stock In or Stock Out.
6. Review the updated inventory and movement history.

## Reports Workflow

1. Log in as Owner.
2. Open the Reports module.
3. Select a report type.
4. Specify a date range when applicable.
5. Generate the report.
6. Review the displayed records.
7. Export the report as CSV when needed.

---

<a id="api-overview"></a>

# 🔌 API Overview

The backend uses Python Flask to provide REST-style API endpoints for system operations.

## Main API Modules

| API Module | Description |
|---|---|
| Authentication | Login, logout, session validation |
| Owner Dashboard | Owner overview and summary statistics |
| Staff Dashboard | Staff overview and activity summaries |
| Sales | POS checkout and transaction records |
| Reservations | Reservation creation and monitoring |
| Returns | Returns and refund processing |
| Inventory | Stock information and adjustments |
| Products | Product and category management |
| Suppliers | Supplier records and linked products |
| Financial Analytics | Financial performance information |
| Reports | Sales and inventory reporting |
| Users | Owner and Staff account management |

## Selected API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/owner/dashboard` | Owner dashboard data |
| GET | `/api/staff/dashboard` | Staff dashboard data |
| GET | `/api/owner/products` | Retrieve products |
| POST | `/api/owner/products` | Create product |
| PUT | `/api/owner/products/<product_id>` | Update product |
| DELETE | `/api/owner/products/<product_id>` | Delete product |
| GET | `/api/owner/suppliers` | Retrieve suppliers |
| POST | `/api/owner/suppliers` | Create supplier |
| PUT | `/api/owner/suppliers/<supplier_id>` | Update supplier |
| DELETE | `/api/owner/suppliers/<supplier_id>` | Delete supplier |
| GET | `/api/users` | Retrieve user accounts |
| POST | `/api/users` | Create user account |
| PUT | `/api/users/<user_id>` | Update user account |

Authentication is required for protected endpoints. Administrative operations enforce Owner permissions in the Flask backend.

---

<a id="database-information"></a>

# 🗄️ Database Information

CCMC RetailFlow uses **TiDB Cloud Starter**, a cloud-hosted relational database compatible with MySQL.

| Information | Details |
|---|---|
| Database Platform | TiDB Cloud |
| Instance Name | ccmc-retailflow |
| Plan | Starter |
| Database Type | MySQL-Compatible |
| Cloud Provider | Amazon Web Services (AWS) |
| Region | Singapore (ap-southeast-1) |
| Status | Active |

## 🔗 Database Dashboard

https://tidbcloud.com/tidbs/10416062767860575716/overview?orgId=1372813089209389333

### Database Access

Authorized users can access the TiDB Cloud dashboard using their own TiDB Cloud accounts.

Evaluators must accept their invitation and have the appropriate permissions before viewing database records.

Database passwords and connection strings are not included in this public repository.

## Database Tables

The system uses ten core relational tables:

| Table | Purpose |
|---|---|
| users | User account records |
| categories | Product categories |
| suppliers | Supplier information |
| products | Product details and stock quantities |
| sales | Sales transaction records |
| sale_items | Products included in sales |
| orders | Reservation records |
| order_items | Products included in reservations |
| returns | Returned items and refund records |
| inventory_transactions | Stock movement history |

---

<a id="deployment--version-control"></a>

# ☁️ Deployment & Version Control

CCMC RetailFlow is deployed using cloud hosting services.

| Component | Platform |
|---|---|
| Frontend | Netlify Free |
| Backend | Render Free |
| Database | TiDB Cloud Starter |
| Repository | GitHub |
| Version Control | Git |

## Deployment Links

**Live Website:**  
https://ccmc-retailflow.netlify.app/

**Backend:**  
https://bsis3a-sad-team6.onrender.com/

**GitHub Repository:**  
https://github.com/stnnnj/BSIS3A-SAD-Team6

**Database Dashboard:**  
https://tidbcloud.com/tidbs/10416062767860575716/overview?orgId=1372813089209389333

## Version Control

Git and GitHub are used to manage source code, revisions, branches, and team contributions.

GitHub provides a record of:

- Source code changes
- Commit history
- Contributors
- Development branches
- Code integration
- Repository activity

## Development Phases

| Phase | Description |
|---|---|
| Phase 1 | Systems Planning and Selection |
| Phase 2 | Systems Analysis |
| Phase 3 | System Design |
| Phase 4 | System Implementation |

For this project, Team 6 inherited the system analysis from Team 10 and retained responsibility for system design and implementation.

---

<a id="testing"></a>

# 🧪 Testing

CCMC RetailFlow uses different testing approaches to evaluate its system functionality, backend services, and database operations.

| Testing Type | Focus | Tool |
|---|---|---|
| Unit Testing | Individual functions and validation | pytest |
| Integration Testing | Backend and database interactions | pytest |
| Functional Testing | System modules and user workflows | Manual Testing / pytest |
| API Testing | Endpoint requests and responses | Postman |
| Deployment Testing | Hosted system connectivity | Netlify, Render, TiDB Cloud |

## Running Automated Tests

From the repository root, execute:

```powershell
python -m pytest tests -v
```

To run specific testing categories:

```powershell
python -m pytest tests/unit tests/integration tests/functional -v
```

To generate a test result file:

```powershell
python -m pytest tests -v --junitxml=test_results.xml
```

Testing results should be documented according to their actual execution status.

---

<a id="security--limitations"></a>

# 🛡️ Security & Limitations

## Security Measures

- Role-Based Access Control
- Owner and Staff Authentication
- Password Hashing
- Flask Session Management
- Backend Request Validation
- Protected Administrative Endpoints
- Database Access Restrictions
- HTTPS for Hosted Services
- Environment Variable Management

## Security Best Practices

- Never commit `.env` files to GitHub.
- Never publish production database credentials.
- Restrict administrative access to authorized users.
- Change demonstration passwords after evaluation.
- Keep database connection information private.
- Use HTTPS for deployed services.
- Maintain updated dependencies.

## System Limitations

- Designed for a single-branch retail clothing shop.
- Cash and GCash payments are recorded internally.
- No external payment gateway integration.
- Free-tier hosting may experience startup delays.
- Hosting and database usage are subject to service limits.
- The system supports Owner and Staff accounts only.

---

<a id="authors"></a>

# 👨‍💻 Authors

**Team 6 – BSIS 3A**  
**Technological University of the Philippines**

| Member | Role |
|---|---|
| Justin Jose L. Calleja | Project Manager / System Integration Lead |
| Jayvee | Frontend Developer – Staff Modules |
| Erick | Frontend Developer – Owner Modules |
| Mark | Backend Developer – Flask APIs |
| Lorenzo M. Duco | Database and Backend Developer |

---

<a id="license"></a>

# 📄 License

This project was developed for academic purposes as part of the Systems Analysis and Design course at the Technological University of the Philippines.

No open-source license has been specified. All project materials remain subject to the rights of the respective project contributors.
