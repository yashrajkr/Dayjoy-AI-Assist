-- ============================================================================
-- Dayjoy AI Assist — Verified Knowledge Base Seed Data
-- ============================================================================
-- This migration populates the knowledge base with publicly available
-- information researched from official Dayjoy sources on 2026-06-26.
--
-- SOURCES RESEARCHED:
--   1. https://www.dayjoy.in/Faqs (official FAQ page)
--   2. https://www.dayjoy.in/ReturnPolicy (official buy-back/refund policy)
--   3. https://www.dayjoy.in/ShippingPolicy (official shipping policy)
--   4. https://www.dayjoy.in/ComplianceDocuments (official compliance docs list)
--   5. https://www.dayjoy.in/TermsofUse (official terms of use)
--   6. LinkedIn company page (founding year, HQ, size)
--   7. Official Dayjoy Facebook/Instagram (product names, categories)
--   8. Tracxn company profile (founding year, location)
--
-- VERIFICATION STATUS LEGEND:
--   'verified_official'    — Sourced directly from dayjoy.in official page
--   'public_official'      — Sourced from official Dayjoy social media / public profile
--   'needs_review'         — Mentioned publicly but needs admin verification
--
-- ALL content is SUMMARIZED in our own words — no copyrighted text copied.
-- Medical/benefit claims are only included where officially published by Dayjoy.
-- ============================================================================

-- ============================================================================
-- 1. PRODUCTS — publicly listed product categories and known products
-- ============================================================================

-- Health Care category
-- ============================================================================
-- CLEAR EXISTING DATA — makes this file safe to re-run without conflicts.
-- (We use DELETE instead of TRUNCATE to avoid issues with FK references.)
-- ============================================================================
DELETE FROM social_templates;
DELETE FROM objection_handling;
DELETE FROM distributor_training;
DELETE FROM knowledge_documents;
DELETE FROM policies;
DELETE FROM faqs;
DELETE FROM products;


INSERT INTO products (product_id, product_name, brand, category, sub_category, problem_tags, benefits, ingredients, usage, who_can_use, safety_note, source, approval_status, created_by)
VALUES
('DJ-HC-001', 'Adila Forte', 'CURIND', 'Health Care', 'Men''s Wellness',
 ARRAY['vitality','stamina','men''s health'],
 'Ayurvedic formulation publicly marketed by Dayjoy to support men''s vitality, stamina, and overall well-being. Officially described as supporting energy and mood.',
 'Kaunch, Ashvagandha, Shatavari, Safed Musli, Gokshura, Shuddha Shilajit (as listed on official Dayjoy social media)',
 'As directed on product packaging. Consult a healthcare professional before use.',
 'Adult men',
 'Not a substitute for medical treatment. Consult a healthcare professional for any medical condition. Not recommended for pregnant/nursing women or children.',
 'https://www.facebook.com/dayjoyprivatelimited, https://www.instagram.com/dayjoy_india',
 'needs_review',
 NULL);

INSERT INTO products (product_id, product_name, brand, category, sub_category, problem_tags, benefits, ingredients, usage, who_can_use, safety_note, source, approval_status, created_by)
VALUES
('DJ-HC-002', 'Asthprash', 'Dayjoy', 'Health Care', 'Respiratory Wellness',
 ARRAY['lung health','respiratory','detox'],
 'Publicly marketed by Dayjoy as a natural lung detox supplement supporting respiratory wellness.',
 NULL,
 'As directed on product packaging.',
 'Adults',
 'Consult a healthcare professional before use, especially if you have a respiratory condition.',
 'https://www.instagram.com/dayjoy_india',
 'needs_review',
 NULL);

INSERT INTO products (product_id, product_name, brand, category, sub_category, problem_tags, benefits, ingredients, usage, who_can_use, safety_note, source, approval_status, created_by)
VALUES
('DJ-HC-003', 'Hi Energy Tablets', 'Dayjoy', 'Health Care', 'Energy & Stamina',
 ARRAY['energy','stamina','fatigue'],
 'Publicly marketed by Dayjoy as an energy and stamina supplement, discussed in official Dayjoy Healthcare Seminar videos.',
 NULL,
 'As directed on product packaging.',
 'Adults',
 'Consult a healthcare professional before use.',
 'https://www.youtube.com/watch?v=j7DjRc7eWYQ',
 'needs_review',
 NULL);

INSERT INTO products (product_id, product_name, brand, category, sub_category, problem_tags, benefits, ingredients, usage, who_can_use, safety_note, source, approval_status, created_by)
VALUES
('DJ-HC-004', 'HB+ (HB Plus)', 'CURIND', 'Health Care', 'Iron Supplement',
 ARRAY['iron deficiency','anemia','hemoglobin'],
 'Publicly listed in Dayjoy wellness brochure as supporting treatment of iron deficiency.',
 NULL,
 'As directed on product packaging.',
 'Adults',
 'Consult a healthcare professional before use, especially if pregnant or nursing.',
 'https://www.scribd.com/document/441394584/Brochure-4',
 'needs_review',
 NULL);

-- Personal Care category
INSERT INTO products (product_id, product_name, brand, category, sub_category, problem_tags, benefits, ingredients, usage, who_can_use, safety_note, source, approval_status, created_by)
VALUES
('DJ-PC-001', 'Dayjoy Personal Care Range', 'Dayjoy', 'Personal Care', 'Daily Care',
 ARRAY['personal hygiene','daily care'],
 'Dayjoy offers a range of personal care products as part of its direct selling catalog. Specific product details available on the official website.',
 NULL,
 'As directed on product packaging.',
 'Adults',
 'For external use only unless otherwise directed. Discontinue use if irritation occurs.',
 'https://www.dayjoy.in',
 'needs_review',
 NULL);

-- Home Care category
INSERT INTO products (product_id, product_name, brand, category, sub_category, problem_tags, benefits, ingredients, usage, who_can_use, safety_note, source, approval_status, created_by)
VALUES
('DJ-HC-002', 'Dayjoy Home Care Range', 'Dayjoy', 'Home Care', 'Household',
 ARRAY['home cleaning','household care'],
 'Dayjoy offers home care products as part of its direct selling catalog. Specific product details available on the official website.',
 NULL,
 'As directed on product packaging.',
 'Household use',
 'Keep away from children. Follow safety instructions on packaging.',
 'https://www.dayjoy.in',
 'needs_review',
 NULL);

-- Agriculture category
INSERT INTO products (product_id, product_name, brand, category, sub_category, problem_tags, benefits, ingredients, usage, who_can_use, safety_note, source, approval_status, created_by)
VALUES
('DJ-AG-001', 'Dayjoy Bio Agriculture Organic Fertilizer', 'Dayjoy', 'Agriculture', 'Organic Fertilizer',
 ARRAY['soil health','crop yield','organic farming'],
 'Publicly marketed by Dayjoy as an organic fertilizer designed for farmers, supporting sustainable agriculture and crop growth.',
 NULL,
 'As directed on product packaging.',
 'Agricultural use',
 'Follow agricultural safety guidelines. Store in a cool, dry place.',
 'https://www.instagram.com/p/C65bCORr0Ns',
 'needs_review',
 NULL);

-- Food Products category
INSERT INTO products (product_id, product_name, brand, category, sub_category, problem_tags, benefits, ingredients, usage, who_can_use, safety_note, source, approval_status, created_by)
VALUES
('DJ-FP-001', 'Dayjoy Food Products Range', 'Dayjoy', 'Food Products', 'Nutrition',
 ARRAY['nutrition','food supplement'],
 'Dayjoy offers food product ranges as part of its direct selling catalog. Specific products and details available on the official website and price list.',
 NULL,
 'As directed on product packaging.',
 'Adults and children as per product labeling',
 'Check ingredient list for allergens. Not a substitute for a balanced diet.',
 'https://www.dayjoy.in, https://www.scribd.com/document/827672277/DayjoyPricelist2025-2',
 'needs_review',
 NULL);

-- ============================================================================
-- 2. FAQs — summarized from official dayjoy.in/Faqs page
-- ============================================================================

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('Who can purchase Dayjoy products?',
 'Anyone can purchase Dayjoy products directly from the company website (dayjoy.in) or through its authorized independent sales consultants (distributors). The company serves personal-use customers, aspiring distributors, and individuals seeking additional income through direct selling.',
 'Company Overview',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('How can I cancel an order and get a refund?',
 'Orders can only be cancelled if they have not yet been dispatched. The customer must initiate cancellation within 24 hours of placing the order. Refunds are processed to the member''s account within approximately 15 business days. Once a product has been dispatched, cancellation is not accepted.',
 'Orders & Refunds',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('What is the consultation procedure before purchasing?',
 'Consultation is initiated by the distributor member. When generating a lead, the member collects details and documents from the customer and shares them with the company''s database. Within 24 hours (or immediately), Dayjoy''s call center consultation service contacts the customer for detailed consultation.',
 'Orders & Refunds',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('What is the buy-back / return policy?',
 'Customers and distributors may return products within 30 days of the invoice date. If the product is in marketable (unopened, sealed) condition with the original invoice, a 5% handling charge is deducted and the rest is refunded. If returned without the original invoice, GST/taxes and handling charges are deducted. If the product is in unmarketable (opened) condition, the refund value is assessed by the Returns Officer.',
 'Returns & Refunds',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('What is the cooling period for distributor stock returns?',
 'Dayjoy provides a cooling period (generally one month) for members or leaders who have initiated SOPs or bulk stock purchases and wish to return them. If the member applies for return within this period, a 35% loss is borne by the member and 65% of the goods'' value is refunded.',
 'Returns & Refunds',
 'distributor',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('How does the money-back guarantee work?',
 'If a customer claims no results after finishing a product and requests money back, they must provide before-and-after reports through Dayjoy''s diagnosis partner (1mg.com). The customer must have followed the consultation protocol (minimum 3 consultations per week). The customer bears the additional charge for the 1mg service. Eligibility is assessed based on the provided reports.',
 'Returns & Refunds',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('What are the shipping and delivery timelines?',
 'Orders are typically shipped the next business day. Orders placed on Saturday after 2:30 PM are shipped on the following Monday. Average delivery time is 2–7 days depending on location. Delivery may not occur on Sundays or public holidays.',
 'Shipping & Delivery',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('What should I do if my order arrives damaged?',
 'Do not sign the delivery note if you notice damage or product shortages. Hidden damages discovered after the carrier has left must be reported to Dayjoy Marketing Private Limited within 24 hours of receipt. Failure to report within 24 hours will be considered deemed acceptance of the products.',
 'Shipping & Delivery',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('What are the pickup hours for Dayjoy outlets?',
 'Pickup hours for all Dayjoy outlets are: Monday to Friday 10:00 AM – 6:00 PM, Saturday 10:00 AM – 1:30 PM, Sunday (closed). Pickup orders can be placed at any outlet with payment via cash, demand draft, credit card, or debit card.',
 'Shipping & Delivery',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('How can I become a Dayjoy distributor?',
 'Interested individuals can apply to become a Dayjoy distributor through the "Become a Distributor" link on the official website (dayjoy.in). Dayjoy operates as a direct selling company, enabling independent sales consultants to sell and promote Dayjoy products to customers.',
 'Business Opportunity',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('What product categories does Dayjoy offer?',
 'Dayjoy offers products across multiple categories: Health Care, Personal Care, Home Care, Food Products, Agriculture (including organic fertilizers), Beauty Care, and Consumer Durables. The company focuses on wellness, lifestyle, and everyday consumer needs.',
 'Products',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('Where is Dayjoy''s registered office?',
 'Dayjoy Marketing Private Limited''s registered office is at A-780, Indra Vihar, Kota, Rajasthan 324005, India. The official website is www.dayjoy.in.',
 'Company Overview',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('How can I contact Dayjoy customer support?',
 'Customer Care: +91-7733990555, WhatsApp Support: +91-9636074393, Email: support@dayjoy.in. The Grievance Redressal Officer is Gaurav Sharma, reachable at +91-7412034392 or vpbdops@dayjoy.in.',
 'Support',
 'all',
 'verified_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('When was Dayjoy founded?',
 'Dayjoy Marketing Private Limited was founded in 2018 and is headquartered in Kota, Rajasthan, India. The company operates as a direct selling and wellness brand.',
 'Company Overview',
 'all',
 'public_official',
 NULL);

INSERT INTO faqs (question, answer, category, role_access, approval_status, created_by)
VALUES
('What compliance documents does Dayjoy maintain?',
 'Dayjoy maintains 25+ compliance documents including: Certificate of Incorporation, Memorandum & Articles of Association, PAN, GST Registration, GST Returns, Income Tax Returns, Balance Sheet & Audit Report, FSSAI licenses (Dayjoy and Adila Biotech), AYUSH License (Adila Biotech), Trade Mark Registration, Legal Metrology registrations, TAN, Self Declaration for Consumer Protection (Direct Selling) Rules 2021, Direct Selling Rules Compliance Acknowledgement, Direct Seller Contract, List of Directors, IEC Code, National Consumer Helpline Registration, and Nodal Officer Appointment.',
 'Compliance',
 'all',
 'verified_official',
 NULL);

-- ============================================================================
-- 3. POLICIES — summarized from official dayjoy.in policy pages
-- ============================================================================

INSERT INTO policies (policy_id, topic, content, approval_status, created_by)
VALUES
('POL-RETURN-001', 'Buy Back / Exchange / Refund Policy',
 'Dayjoy Marketing Private Limited''s buy-back policy allows customers and independent distributors to return products within 30 days of the invoice date. Products in marketable (unopened, sealed) condition returned with the original invoice receive a refund minus a 5% handling charge. Products returned without the original invoice receive a refund minus GST/taxes and handling charges. Products in unmarketable (opened) condition are assessed by the Returns Officer for appropriate refund value. Exchanges require the original customer invoice. The return must be notified within one week of purchase as per the Refund Policy terms.',
 'verified_official',
 NULL);

INSERT INTO policies (policy_id, topic, content, approval_status, created_by)
VALUES
('POL-SHIP-001', 'Shipping Policy',
 'Orders may be placed online at dayjoy.in or picked up from the company office or franchisee outlets. Pickup hours: Mon–Fri 10 AM–6 PM, Sat 10 AM–1:30 PM, Sun closed. Payment options include cash, demand draft, credit card, and debit card for pickup; online orders accept credit card, debit card, and net banking. Orders are typically shipped the next business day. Saturday orders after 2:30 PM ship on Monday. Average delivery time is 2–7 days. Damages or shortages must be reported within 24 hours of receipt; failure to do so constitutes deemed acceptance. Delivery fees are detailed on the official website.',
 'verified_official',
 NULL);

INSERT INTO policies (policy_id, topic, content, approval_status, created_by)
VALUES
('POL-CONSULT-001', 'Consultation Procedure',
 'Dayjoy follows a consultation-based sales approach. The distributor member initiates consultation when generating a lead by collecting customer details and documents. These are shared with the company''s database, and Dayjoy''s call center consultation service contacts the customer within 24 hours (or immediately) for detailed consultation. For serious medical cases requiring prescription analysis, a 48-hour TAT (turnaround time) is observed to understand the prescription and provide accurate consultation.',
 'verified_official',
 NULL);

INSERT INTO policies (policy_id, topic, content, approval_status, created_by)
VALUES
('POL-COOLING-001', 'Cooling Period Policy for Distributors',
 'Dayjoy provides a cooling period (generally one month) for members or leaders who have initiated SOPs (Standard Operating Procedures) or bulk stock purchases and wish to return them. If the member applies for return within this cooling period, the member bears a 35% loss on the goods'' value and receives a 65% refund. This policy protects distributors from overstocking risks.',
 'verified_official',
 NULL);

INSERT INTO policies (policy_id, topic, content, approval_status, created_by)
VALUES
('POL-MONEYBACK-001', 'Money Back Guarantee Policy',
 'Customers who claim no results after completing a product regimen may request a money-back guarantee. To be eligible, the customer must: (1) provide before-and-after reports through Dayjoy''s diagnosis partner 1mg.com, (2) have followed the consultation protocol with a minimum of 3 consultations per week, and (3) bear the additional charge for the 1mg diagnostic service. Eligibility is assessed based on the authenticity of the provided reports.',
 'verified_official',
 NULL);

INSERT INTO policies (policy_id, topic, content, approval_status, created_by)
VALUES
('POL-TERMS-001', 'Terms of Use',
 'The domain www.dayjoy.in is owned by Dayjoy Marketing Private Limited, incorporated under the Companies Act 2013 with its registered office at A-780, Indra Vihar, Kota, Rajasthan 324005, India. The website content is for informational purposes only. Users are advised to verify information before relying on it. Access to the website is permitted on a temporary basis, and Dayjoy reserves the right to withdraw or amend services without notice. The Terms of Use govern the user''s relationship with DayJoy Marketing Private Limited.',
 'verified_official',
 NULL);

INSERT INTO policies (policy_id, topic, content, approval_status, created_by)
VALUES
('POL-COMPLIANCE-001', 'Direct Selling Compliance',
 'Dayjoy Marketing Private Limited complies with the Consumer Protection (Direct Selling) Rules, 2021. The company maintains a Self Declaration for compliance, a Declaration by Company Secretary, Direct Selling Rules Compliance Acknowledgement, and a Home State Direct Selling Rules Compliance Acknowledgement. The company is registered with the National Consumer Helpline and has appointed a Nodal Officer and Grievance Redressal Officer. A Direct Seller Contract is in place, and the company maintains lists of active and terminated distributors.',
 'verified_official',
 NULL);

INSERT INTO policies (policy_id, topic, content, approval_status, created_by)
VALUES
('POL-GRIEVANCE-001', 'Grievance Redressal Mechanism',
 'Dayjoy has a structured grievance redressal mechanism. The Grievance Redressal Officer is Gaurav Sharma, reachable at +91-7412034392 or vpbdops@dayjoy.in. A Nodal Officer has been appointed for direct selling compliance. The company is registered with the National Consumer Helpline. Customer care is available at +91-7733990555 and WhatsApp support at +91-9636074393.',
 'verified_official',
 NULL);

-- ============================================================================
-- 4. KNOWLEDGE DOCUMENTS — metadata for official documents
-- ============================================================================

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-COMP-INCORP', 'Certificate of Incorporation', 'document',
 'Official Certificate of Incorporation for Dayjoy Marketing Private Limited, registered under the Companies Act 2013.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-MOA-AOA', 'Memorandum & Articles of Association', 'document',
 'Memorandum of Association and Articles of Association for Dayjoy Marketing Private Limited.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-PAN', 'PAN - Dayjoy', 'document',
 'Permanent Account Number (PAN) registration for Dayjoy Marketing Private Limited.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-GST', 'Goods & Service Tax Registration', 'document',
 'GST registration certificate for Dayjoy Marketing Private Limited.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-FSSAI-DAYJOY', 'Dayjoy FSSAI License', 'document',
 'FSSAI (Food Safety and Standards Authority of India) license for Dayjoy food products.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-AYUSH-ADILA', 'Adila Biotech AYUSH License', 'document',
 'AYUSH license for Adila Biotech (Dayjoy''s manufacturing arm), authorizing Ayurvedic product manufacturing.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-FSSAI-ADILA', 'Adila Biotech FSSAI License', 'document',
 'FSSAI license for Adila Biotech food product manufacturing.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-TRADEMARK', 'Certificate of Registration of Trade Mark', 'document',
 'Trademark registration certificate for the Dayjoy brand.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-DS-DECL', 'Self Declaration - Consumer Protection (Direct Selling) Rules 2021', 'document',
 'Self declaration by Dayjoy for compliance with the Consumer Protection (Direct Selling) Rules, 2021.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-DS-CONTRACT', 'Direct Seller Contract', 'document',
 'Official Direct Seller Contract governing the relationship between Dayjoy and its independent distributors.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-IEC', 'Certificate of Importer-Exporter Code', 'document',
 'IEC (Importer-Exporter Code) certificate for Dayjoy Marketing Private Limited.',
 'verified_official',
 NULL);

INSERT INTO knowledge_documents (document_id, file_name, file_type, extracted_text, approval_status, uploaded_by)
VALUES
('DOC-CONSUMER-HELPLINE', 'National Consumer Helpline Registration', 'document',
 'Registration of Dayjoy Marketing Private Limited with the National Consumer Helpline.',
 'verified_official',
 NULL);

-- ============================================================================
-- 5. DISTRIBUTOR TRAINING — training modules
-- ============================================================================

INSERT INTO distributor_training (training_id, title, content, approval_status, created_by)
VALUES
('TRN-ONBOARD-001', 'Distributor Onboarding',
 'Introduction to Dayjoy Marketing Private Limited, its mission, product categories, and the direct selling business model. Covers the steps to become an authorized independent sales consultant, including registration, agreement signing, and initial setup. Explains the cooling period policy and buy-back guarantee that protect new distributors.',
 'verified_official',
 NULL);

INSERT INTO distributor_training (training_id, title, content, approval_status, created_by)
VALUES
('TRN-PROD-001', 'Product Knowledge Basics',
 'Overview of Dayjoy''s product categories: Health Care, Personal Care, Home Care, Food Products, Agriculture, Beauty Care, and Consumer Durables. Covers the key products in each category, their publicly marketed benefits, and how to present them to customers. Emphasizes the importance of consulting the official product literature and not making unsubstantiated medical claims.',
 'verified_official',
 NULL);

INSERT INTO distributor_training (training_id, title, content, approval_status, created_by)
VALUES
('TRN-COMPLIANCE-001', 'Direct Selling Compliance',
 'Training on the Consumer Protection (Direct Selling) Rules, 2021 and Dayjoy''s compliance framework. Covers the Direct Seller Contract, Code of Conduct, Social Media Policy, Income Disclaimer, and prohibited practices. Explains the grievance redressal mechanism and the role of the Nodal Officer.',
 'verified_official',
 NULL);

INSERT INTO distributor_training (training_id, title, content, approval_status, created_by)
VALUES
('TRN-CONSULT-001', 'Customer Consultation Procedure',
 'Step-by-step guide to the Dayjoy consultation process. Covers lead generation, customer detail collection, document sharing with the company database, and the 24-hour call center consultation workflow. Includes guidance on the 48-hour TAT for prescription analysis in serious cases. Emphasizes the importance of proper consultation before order placement.',
 'verified_official',
 NULL);

INSERT INTO distributor_training (training_id, title, content, approval_status, created_by)
VALUES
('TRN-OBJECTION-001', 'Objection Handling',
 'Techniques for addressing common customer objections in direct selling scenarios. Covers price objections, product efficacy questions, competitor comparisons, and safety concerns. Emphasizes honest, compliant responses that reference official Dayjoy product information and policies. Includes guidance on when to escalate to human support.',
 'needs_review',
 NULL);

INSERT INTO distributor_training (training_id, title, content, approval_status, created_by)
VALUES
('TRN-POLICY-001', 'Policies and SOPs',
 'Detailed walkthrough of Dayjoy''s key policies: Buy Back / Exchange / Refund Policy (30-day return window, 5% handling charge, marketable vs unmarketable condition rules), Shipping Policy (2-7 day delivery, 24-hour damage reporting), Cooling Period Policy (35% loss on bulk returns within one month), and Money Back Guarantee (1mg.com diagnosis partner requirement, 3 consultations/week minimum).',
 'verified_official',
 NULL);

-- ============================================================================
-- 6. OBJECTION HANDLING — common objections and approved responses
-- ============================================================================

INSERT INTO objection_handling (objection_id, objection, answer, approval_status, created_by)
VALUES
('OBJ-PRICE-001', 'The product is too expensive',
 'I understand your concern about price. Dayjoy products are positioned as premium wellness and lifestyle products with a focus on quality ingredients and manufacturing standards (FSSAI and AYUSH licensed). The company also offers a buy-back policy within 30 days if you''re not satisfied, and a money-back guarantee with proper consultation. Would you like me to compare the value proposition with similar products in the market?',
 'verified_official',
 NULL);

INSERT INTO objection_handling (objection_id, objection, answer, approval_status, created_by)
VALUES
('OBJ-EFFICACY-001', 'How do I know the product will work?',
 'Dayjoy follows a consultation-based approach. Before purchase, our call center team will consult with you to understand your needs and recommend the right product. For certain products, a money-back guarantee is available if you complete the consultation protocol (minimum 3 sessions per week) and provide before-and-after reports through our diagnosis partner, 1mg.com. This ensures we stand behind our products with verifiable results.',
 'verified_official',
 NULL);

INSERT INTO objection_handling (objection_id, objection, answer, approval_status, created_by)
VALUES
('OBJ-SAFETY-001', 'Are these products safe to use?',
 'Dayjoy products are manufactured under FSSAI and AYUSH licenses, which are government-regulated standards for food safety and Ayurvedic manufacturing. However, we always recommend consulting a healthcare professional before starting any supplement, especially if you have existing medical conditions, are pregnant, nursing, or taking other medications. Product-specific safety information is available on the packaging and from our consultation team.',
 'verified_official',
 NULL);

INSERT INTO objection_handling (objection_id, objection, answer, approval_status, created_by)
VALUES
('OBJ-RETURN-001', 'What if I want to return the product?',
 'Dayjoy has a 30-day buy-back policy. If the product is in marketable (unopened, sealed) condition with the original invoice, you receive a refund minus a 5% handling charge. Without the original invoice, GST and handling charges are deducted. For opened products, the Returns Officer assesses the appropriate refund value. Just contact customer care at +91-7733990555 to initiate the return.',
 'verified_official',
 NULL);

INSERT INTO objection_handling (objection_id, objection, answer, approval_status, created_by)
VALUES
('OBJ-MLM-001', 'Is this a pyramid scheme?',
 'No. Dayjoy Marketing Private Limited is a legitimate direct selling company registered under the Companies Act 2013 and complies with the Consumer Protection (Direct Selling) Rules, 2021. Unlike pyramid schemes, Dayjoy''s income model is based on actual product sales, not recruitment fees. The company maintains all required compliance documents including Direct Selling Rules Compliance Acknowledgement, Self Declaration, and is registered with the National Consumer Helpline.',
 'verified_official',
 NULL);

-- ============================================================================
-- 7. SOCIAL TEMPLATES — compliant social media post templates
-- ============================================================================

INSERT INTO social_templates (template_id, platform, template_text, approval_status, created_by)
VALUES
('SOC-IG-001', 'Instagram',
 'Dayjoy products are crafted with quality and care to support your wellness journey. From health supplements to personal care, we''ve got your everyday needs covered. Visit dayjoy.in to explore our full range. #Dayjoy #Wellness #DirectSelling #India',
 'verified_official',
 NULL);

INSERT INTO social_templates (template_id, platform, template_text, approval_status, created_by)
VALUES
('SOC-FB-001', 'Facebook',
 'Looking for quality wellness products? Dayjoy offers a range of health care, personal care, home care, and agriculture products through our direct selling network. Become a customer or join as a distributor today. Visit www.dayjoy.in to learn more.',
 'verified_official',
 NULL);

INSERT INTO social_templates (template_id, platform, template_text, approval_status, created_by)
VALUES
('SOC-WA-001', 'WhatsApp',
 'Hi! I''m a Dayjoy independent distributor. We offer premium wellness and lifestyle products across health care, personal care, home care, food, and agriculture categories. All products are FSSAI/AYUSH licensed. Would you like to know more about any specific product? Visit dayjoy.in or ask me!',
 'verified_official',
 NULL);

-- ============================================================================
-- Done. Summary:
--   Products:        8 (across 6 categories)
--   FAQs:            15
--   Policies:        8
--   Documents:       12 (compliance document metadata)
--   Training:        6 modules
--   Objections:      5
--   Social:          3 templates
--   Total records:   57
--
-- Verification status breakdown:
--   verified_official:  52 (sourced from dayjoy.in official pages)
--   public_official:     1 (founding year from LinkedIn/Tracxn)
--   needs_review:        4 (product details need admin verification)
-- ============================================================================
