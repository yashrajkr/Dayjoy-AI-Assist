export const products = [
  { name: 'Asthprash', brand: 'Dayjoy', category: 'Health Care', tags: ['respiratory', 'wellness', 'immunity'], benefits: 'Supports general respiratory wellness and daily wellbeing.', usage: 'Use as per product label.', safety: 'General wellness information, not medical advice.' },
  { name: 'Golden Elixir', brand: 'Curind', category: 'Health Care', tags: ['curcumin', 'wellness', 'joint'], benefits: 'Supports general wellness with curcumin-based positioning.', usage: 'Use as per official label guidance.', safety: 'Consult a qualified professional for medical concerns.' },
  { name: 'Wild Muse Face Wash', brand: 'Wild Muse', category: 'Personal Care', tags: ['skin', 'cleansing', 'beauty'], benefits: 'Cleanses and refreshes skin for daily personal care.', usage: 'Apply externally and rinse.', safety: 'External use only. Avoid contact with eyes.' },
  { name: 'Happy Soil', brand: 'Happygrow', category: 'Agriculture', tags: ['soil', 'farming', 'plant growth'], benefits: 'Supports soil quality and plant growth.', usage: 'Use as per agriculture label instructions.', safety: 'Use only as directed.' },
];

export const faqItems = [
  { question: 'Are Dayjoy products medicines?', answer: 'No. They should be explained as wellness, personal care, food, home care, or agriculture products. Avoid cure or treatment claims.', status: 'Approved' },
  { question: 'Does Dayjoy guarantee income?', answer: 'No. Business results depend on product sales, effort, training, and compliance. Do not promise fixed income.', status: 'Approved' },
  { question: 'What should AI do when data is missing?', answer: 'It should say verified information is not available and recommend human support or admin review.', status: 'Approved' },
];

export const documents = [
  { name: 'Dayjoy Product Brochure.pdf', type: 'Product Brochure', status: 'Pending Review', confidence: 92, uploadedBy: 'Employee Team', date: 'Today' },
  { name: 'Distributor Training Manual.pdf', type: 'Training', status: 'Approved', confidence: 98, uploadedBy: 'Training Team', date: 'Yesterday' },
  { name: 'Policy Guidelines.pdf', type: 'Policy', status: 'Approved', confidence: 96, uploadedBy: 'Admin', date: '2 days ago' },
];

export const leads = [
  { name: 'Rahul Kumar', phone: '+91 98XXXXXX21', category: 'Health Care', type: 'Customer', status: 'New', region: 'Jharkhand' },
  { name: 'Priya Sharma', phone: '+91 88XXXXXX42', category: 'Distributor', type: 'Distributor', status: 'Follow-up needed', region: 'Rajasthan' },
  { name: 'Amit Singh', phone: '+91 77XXXXXX63', category: 'Skin Care', type: 'Customer', status: 'Contacted', region: 'Bihar' },
];

export const tickets = [
  { title: 'Customer asked cure claim question', priority: 'High', status: 'Escalated', category: 'Compliance' },
  { title: 'Distributor requested product brochure', priority: 'Normal', status: 'Open', category: 'Knowledge' },
  { title: 'Lead wants Hindi callback', priority: 'Normal', status: 'In Progress', category: 'Lead' },
];
