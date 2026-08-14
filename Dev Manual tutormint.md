# TutorMint Platform Documentation & Master Architecture

## 1. Executive Summary & Brand Identity
* **Platform Name**: TutorMint
* **Core Mission**: Providing verified home tutoring and online education services across a nationwide footprint.
* **Official Branding Elements**:
  * **Brand Red**: `#B3191F` (utilised for primary buttons, active tab indicators, and brand highlights).
  * **Professional Tone**: Clean, modern, trustworthy, and optimized for seamless user acquisition.

---

## 2. Completed Architecture & Features (Current State)
The foundational infrastructure, frontend UI, and database connectivity have been successfully built, tested, and integrated:

* **Nationwide Registration UI (`/tutor/register`)**:
  * Developed a modern, multi-step registration wizard divided into three distinct tabs: **Identity**, **Location & Academics**, and **Preferences**.
  * Implemented strict input fields for Full Name, Email Address, CNIC, Phone & WhatsApp numbers, Province, City, and Academic Degrees.
  * Added dynamic conditional rendering for online teaching preferences (e.g., platforms like Zoom, Google Meet, Skype).
* **UI/UX Polish & Brand Styling**:
  * Integrated the official brand red (`#B3191F`) into primary action buttons ("Continue", "Submit Application") and active tab bottom-border highlights to establish strong visual hierarchy.
  * Prevented accidental browser/dropdown auto-submission quirks by decoupling native form behavior and adding robust field validation.
* **Backend API Route (`/api/tutor/register`)**:
  * Built a secure Next.js App Router API endpoint (`route.ts`) to handle incoming POST requests from the registration form.
  * Implemented data sanitization logic to convert comma-separated string inputs (such as degrees and online platforms) into clean arrays required by the database schema.
* **MongoDB Database Integration**:
  * Configured a robust Mongoose connection layer (`lib/mongodb.ts`) coupled with a strict `Tutor` data schema.
  * Whitelisted universal server access (`0.0.0.0/0`) within MongoDB Atlas to seamlessly support local development environments and production deployments.
  * Added automated duplicate detection handling for unique credentials (such as existing email or CNIC entries).
* **Interactive Confirmation Modal**:
  * Replaced full-page redirects with a sleek, centered popup modal upon successful form submission.
  * Displays a verified green checkmark and the mandatory confirmation message: *"Tutor Appliction received our team will contact you on your provide contact details"*.

---

## 3. Upcoming Development Roadmap (Future Scope)
To scale TutorMint into a fully functional, production-ready marketplace platform, the following features are planned for upcoming development cycles:

* **Admin Verification Dashboard**:
  * Build an authenticated back-office panel where administrators can review incoming "Pending" tutor applications, inspect credentials, and manually approve or reject profiles.
* **Public Tutor Directory & Search**:
  * Develop a searchable, filterable public catalog allowing parents and students to find verified tutors based on city, province, academic subjects, and teaching mode (Physical vs. Online).
* **Authentication & User Portals**:
  * Implement role-based login portals for Tutors, Parents/Students, and Administrators using secure session management.
* **Automated Notifications**:
  * Integrate email or SMS notification services (via third-party providers) to automatically alert tutors upon profile approval and notify support teams of new submissions.