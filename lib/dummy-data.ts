export type Screen = 'home' | 'activity' | 'insights' | 'profile'

export type Transaction = {
  id: string
  merchant: string
  category: string
  amount: number
  date: string
  icon: string
  tone: 'violet' | 'orange' | 'blue' | 'green' | 'pink'
}

export const user = { name: 'Alex', initials: 'AL', plan: 'Echo Plus' }

export const transactions: Transaction[] = [
  { id: '1', merchant: 'Whole Foods Market', category: 'Groceries', amount: 82.43, date: 'Today, 9:42 AM', icon: 'W', tone: 'green' },
  { id: '2', merchant: 'Netflix', category: 'Entertainment', amount: 15.49, date: 'Yesterday, 7:10 PM', icon: 'N', tone: 'pink' },
  { id: '3', merchant: 'Uber', category: 'Transport', amount: 24.8, date: 'Yesterday, 5:32 PM', icon: 'U', tone: 'violet' },
  { id: '4', merchant: 'Blue Bottle Coffee', category: 'Food & Drink', amount: 6.75, date: 'Mon, 8:04 AM', icon: 'B', tone: 'orange' },
  { id: '5', merchant: 'Spotify', category: 'Entertainment', amount: 11.99, date: 'Sun, 12:00 PM', icon: 'S', tone: 'green' },
  { id: '6', merchant: 'Apple', category: 'Technology', amount: 129.0, date: 'Sat, 2:21 PM', icon: 'A', tone: 'blue' },
]

export const categoryData = [
  { name: 'Essentials', value: 46, color: 'var(--chart-1)' },
  { name: 'Lifestyle', value: 31, color: 'var(--chart-2)' },
  { name: 'Transport', value: 14, color: 'var(--chart-3)' },
  { name: 'Other', value: 9, color: 'var(--chart-4)' },
]

export const monthlyData = [
  { month: 'Jan', spend: 2180, budget: 2400 },
  { month: 'Feb', spend: 2420, budget: 2400 },
  { month: 'Mar', spend: 1950, budget: 2400 },
  { month: 'Apr', spend: 2310, budget: 2400 },
  { month: 'May', spend: 2050, budget: 2400 },
  { month: 'Jun', spend: 1870, budget: 2400 },
]

export const insights = [
  { title: 'Your coffee habit', text: 'You spent $124 on coffee this month — 18% more than May.', tag: 'Spending pattern', tone: 'orange' as const },
  { title: 'Nice work, Alex', text: 'You are on track to save $320 this month if you keep your current pace.', tag: 'Positive trend', tone: 'green' as const },
  { title: 'Subscription check', text: 'You have 7 active subscriptions. Two have not been used in 30 days.', tag: 'Opportunity', tone: 'violet' as const },
]

export const merchants = [
  { name: 'Whole Foods Market', amount: '$246.80', count: '4 visits' },
  { name: 'Uber', amount: '$138.40', count: '9 rides' },
  { name: 'Blue Bottle Coffee', amount: '$124.15', count: '18 visits' },
]
