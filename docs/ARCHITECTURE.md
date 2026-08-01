# Dayjoy AI Assistant - Architecture

## Overview

The Dayjoy AI Assistant platform consists of **two separate applications**:

1. **Dayjoy AI Assist (User App)** - Customer-facing ChatGPT-style interface
2. **Admin Console** - Internal management dashboard for employees/admins

---

## 1. Dayjoy AI Assist (User App)

**Route:** `/`

**Purpose:** ChatGPT-like interface where customers, distributors, and employees ask Dayjoy-related questions and receive AI-powered answers.

### Features:
- ChatGPT-style sidebar with chat history
- Main chat area with suggested prompts
- AI answer cards with product recommendations
- Source citations and confidence scores
- Right-side panel for related products and sources
- File upload support
- Safety disclaimers and compliance badges
- Human handoff for uncertain queries
- Multi-language support (English, Hindi, Hinglish)

### Target Users:
- Customers seeking product information
- Distributors needing business support
- Employees using AI assistance

### Key Pages:
- `/` - Main chat interface
- `/chat/:chatId` - Specific chat conversation

### Design:
- Clean ChatGPT-inspired layout
- Left sidebar (chat history, categories)
- Center chat area (messages, input)
- Right panel (sources, products, FAQs)
- Green/cream premium wellness aesthetic

---

## 2. Admin Console

**Route:** `/admin`

**Purpose:** Internal dashboard where Dayjoy employees and admins manage the knowledge base, approve content, monitor AI performance, and control system settings.

### Features:
- Knowledge base management (upload, approve, index documents)
- Product database CRUD operations
- FAQ management
- Knowledge approval queue
- AI safety rules and compliance controls
- User management and permissions
- Support ticket handling
- Analytics and reporting
- Audit logs

### Target Users:
- Dayjoy employees
- Content approval team
- System administrators
- Management

### Key Pages:
- `/admin/dashboard` - Overview with KPIs and alerts
- `/admin/knowledge` - Upload and manage documents
- `/admin/products` - Product database management
- `/admin/faqs` - FAQ editor
- `/admin/approvals` - Knowledge approval queue
- `/admin/safety` - AI safety rules and blocked phrases
- `/admin/users` - User management
- `/admin/support` - Support tickets
- `/admin/analytics` - Performance analytics

### Design:
- Enterprise SaaS dashboard layout
- Left sidebar navigation
- Top search bar and notifications
- Data-heavy tables and cards
- Professional business aesthetic

---

## Design System

### Color Palette:
```css
Primary Dark Green: #234F1E
Secondary Green: #4F6F46
Light Green: #DDEDD5
Cream Background: #F8F7EE
White Cards: #FFFFFF
Beige Accent: #F3EAD8
Gold Accent: #FFC98B
Charcoal Text: #1F1F1F
Muted Gray: #6B6B6B
Error Red: #C62828
Warning Amber: #B7791F
```

### Key Principles:
- Premium wellness SaaS aesthetic
- Calm, professional, trustworthy
- Minimal shadows, clean spacing
- Rounded corners (0.75rem default)
- Consistent typography
- Mobile-responsive user app
- Desktop-first admin console

---

## Data Flow

### User Query Flow:
1. User asks question in Dayjoy AI Assist
2. AI searches approved knowledge base
3. AI generates answer with source citations
4. User sees product recommendations
5. Unsafe queries blocked by safety rules
6. Uncertain queries escalated to human support

### Admin Approval Flow:
1. Employee uploads document to knowledge base
2. AI extracts and analyzes content
3. Document enters approval queue
4. Admin reviews extracted data
5. Admin approves/rejects document
6. Approved content becomes searchable by AI

### Content Management Flow:
1. Admin adds/updates products in database
2. Admin sets approval status
3. Only approved products shown to users
4. Changes logged in audit trail
5. Analytics track product demand

---

## Security & Compliance

### User App:
- Source citation required for all answers
- Medical claim blocking
- Income guarantee prevention
- Safety disclaimers on all product recommendations
- Human handoff for uncertain/risky queries

### Admin Console:
- Restricted to authorized Dayjoy staff only
- Role-based access control
- Approval workflow for all content
- Audit logs for all changes
- AI safety rule management
- Blocked phrase enforcement

---

## Technology Stack

- **Frontend Framework:** React 18
- **Routing:** React Router 7
- **Styling:** Tailwind CSS v4
- **UI Components:** Radix UI
- **Icons:** Lucide React
- **Build Tool:** Vite
- **Package Manager:** pnpm

---

## Navigation

- **User to Admin:** Link in user sidebar footer ("Staff? Access Admin Console")
- **Admin to User:** Link in admin sidebar footer ("View User App")
- **App Selector:** `/select` (optional landing page)

---

## Key Differentiators

| Feature | User App | Admin Console |
|---------|----------|---------------|
| Layout | ChatGPT-style sidebar + chat | Enterprise dashboard |
| Users | Customers, Distributors | Staff, Admins only |
| Purpose | Ask questions, get AI answers | Manage knowledge, approve content |
| Complexity | Simple, focused | Data-heavy, powerful |
| Mobile | Responsive | Desktop-first |
| Access | Public (with login) | Restricted staff only |

---

## Important Notes

- **Never mix apps:** Customers should NEVER see admin tools
- **Approval required:** All knowledge must be approved before AI can use it
- **Safety first:** Every AI answer shows confidence and source
- **Compliance:** Medical/income claims automatically blocked
- **Audit trail:** All admin actions logged
- **Source citation:** Required for all AI responses

---

## Future Enhancements

- WhatsApp bot integration
- Voice assistant support
- Mobile app (iOS/Android)
- CRM integration
- Multi-region support
- Advanced analytics dashboards
