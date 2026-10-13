package pk.ironclad.ledger.data

/**
 * What a brand-new ledger starts with: the things a BPO floor actually spends on.
 *
 * Ids are fixed strings rather than random ones so a phone that seeds itself
 * offline lines up with another that did the same. Entries point at categories and
 * campaigns by NAME, the way the sheet does, so an id that differs between devices
 * never hurts the history.
 */
object Seed {

    val categories: List<Category> = listOf(
        Category(id = "cat-agent-salaries", name = "Agent salaries", group = "Payroll & people", kind = Type.EXPENSE, icon = "👥", colour = "#43A047", rule = "", sort = 10),
        Category(id = "cat-supervisor-salaries", name = "Supervisor salaries", group = "Payroll & people", kind = Type.EXPENSE, icon = "🧑‍💼", colour = "#388E3C", rule = "", sort = 20),
        Category(id = "cat-management-salaries", name = "Management salaries", group = "Payroll & people", kind = Type.EXPENSE, icon = "🧑‍💻", colour = "#2E7D32", rule = "By seats", sort = 30),
        Category(id = "cat-commissions-bonuses", name = "Commissions & bonuses", group = "Payroll & people", kind = Type.EXPENSE, icon = "🏆", colour = "#7CB342", rule = "", sort = 40),
        Category(id = "cat-overtime", name = "Overtime", group = "Payroll & people", kind = Type.EXPENSE, icon = "⏱️", colour = "#9CCC65", rule = "", sort = 50),
        Category(id = "cat-eobi-social-security", name = "EOBI & social security", group = "Payroll & people", kind = Type.EXPENSE, icon = "🏛️", colour = "#689F38", rule = "By agents", sort = 60),
        Category(id = "cat-recruitment-ads", name = "Recruitment & ads", group = "Payroll & people", kind = Type.EXPENSE, icon = "📢", colour = "#8BC34A", rule = "", sort = 70),
        Category(id = "cat-training", name = "Training", group = "Payroll & people", kind = Type.EXPENSE, icon = "🎓", colour = "#AED581", rule = "", sort = 80),
        Category(id = "cat-staff-meals-tea", name = "Staff meals & tea", group = "Payroll & people", kind = Type.EXPENSE, icon = "☕", colour = "#6D4C41", rule = "By agents", sort = 90),
        Category(id = "cat-night-transport", name = "Night transport", group = "Payroll & people", kind = Type.EXPENSE, icon = "🚐", colour = "#795548", rule = "By agents", sort = 100),
        Category(id = "cat-office-rent", name = "Office rent", group = "Facilities", kind = Type.EXPENSE, icon = "🏢", colour = "#7E57C2", rule = "By seats", sort = 110),
        Category(id = "cat-electricity", name = "Electricity", group = "Facilities", kind = Type.EXPENSE, icon = "⚡", colour = "#FDD835", rule = "By seats", sort = 120),
        Category(id = "cat-generator-fuel", name = "Generator fuel", group = "Facilities", kind = Type.EXPENSE, icon = "⛽", colour = "#6D4C41", rule = "By seats", sort = 130),
        Category(id = "cat-generator-maintenance", name = "Generator maintenance", group = "Facilities", kind = Type.EXPENSE, icon = "🔧", colour = "#8D6E63", rule = "By seats", sort = 140),
        Category(id = "cat-ups-batteries", name = "UPS & batteries", group = "Facilities", kind = Type.EXPENSE, icon = "🔋", colour = "#FFB300", rule = "By seats", sort = 150),
        Category(id = "cat-water", name = "Water", group = "Facilities", kind = Type.EXPENSE, icon = "💧", colour = "#29B6F6", rule = "By seats", sort = 160),
        Category(id = "cat-janitorial-supplies", name = "Janitorial & supplies", group = "Facilities", kind = Type.EXPENSE, icon = "🧹", colour = "#26A69A", rule = "By seats", sort = 170),
        Category(id = "cat-security-guard", name = "Security guard", group = "Facilities", kind = Type.EXPENSE, icon = "💂", colour = "#546E7A", rule = "By seats", sort = 180),
        Category(id = "cat-repairs-maintenance", name = "Repairs & maintenance", group = "Facilities", kind = Type.EXPENSE, icon = "🛠️", colour = "#78909C", rule = "By seats", sort = 190),
        Category(id = "cat-furniture-fixtures", name = "Furniture & fixtures", group = "Facilities", kind = Type.EXPENSE, icon = "🪑", colour = "#A1887F", rule = "By seats", sort = 200),
        Category(id = "cat-internet-primary", name = "Internet — primary", group = "Technology", kind = Type.EXPENSE, icon = "🌐", colour = "#1E88E5", rule = "By seats", sort = 210),
        Category(id = "cat-internet-backup", name = "Internet — backup", group = "Technology", kind = Type.EXPENSE, icon = "📶", colour = "#42A5F5", rule = "By seats", sort = 220),
        Category(id = "cat-dialer-voip-minutes", name = "Dialer / VoIP minutes", group = "Technology", kind = Type.EXPENSE, icon = "☎️", colour = "#0277BD", rule = "", sort = 230),
        Category(id = "cat-dids-numbers", name = "DIDs & numbers", group = "Technology", kind = Type.EXPENSE, icon = "📞", colour = "#039BE5", rule = "", sort = 240),
        Category(id = "cat-crm-subscription", name = "CRM subscription", group = "Technology", kind = Type.EXPENSE, icon = "🗂️", colour = "#5C6BC0", rule = "", sort = 250),
        Category(id = "cat-software-licences", name = "Software licences", group = "Technology", kind = Type.EXPENSE, icon = "💿", colour = "#3949AB", rule = "By agents", sort = 260),
        Category(id = "cat-cloud-hosting", name = "Cloud hosting", group = "Technology", kind = Type.EXPENSE, icon = "☁️", colour = "#7986CB", rule = "By seats", sort = 270),
        Category(id = "cat-computers-laptops", name = "Computers & laptops", group = "Technology", kind = Type.EXPENSE, icon = "💻", colour = "#455A64", rule = "", sort = 280),
        Category(id = "cat-headsets", name = "Headsets", group = "Technology", kind = Type.EXPENSE, icon = "🎧", colour = "#00897B", rule = "", sort = 290),
        Category(id = "cat-peripherals", name = "Peripherals", group = "Technology", kind = Type.EXPENSE, icon = "🖱️", colour = "#26C6DA", rule = "", sort = 300),
        Category(id = "cat-it-repairs", name = "IT repairs", group = "Technology", kind = Type.EXPENSE, icon = "🔌", colour = "#00ACC1", rule = "", sort = 310),
        Category(id = "cat-lead-purchase", name = "Lead purchase", group = "Sales & marketing", kind = Type.EXPENSE, icon = "🎯", colour = "#E53935", rule = "", sort = 320),
        Category(id = "cat-advertising", name = "Advertising", group = "Sales & marketing", kind = Type.EXPENSE, icon = "📣", colour = "#EC407A", rule = "", sort = 330),
        Category(id = "cat-client-entertainment", name = "Client entertainment", group = "Sales & marketing", kind = Type.EXPENSE, icon = "🍽️", colour = "#FB8C00", rule = "", sort = 340),
        Category(id = "cat-travel", name = "Travel", group = "Sales & marketing", kind = Type.EXPENSE, icon = "✈️", colour = "#F4511E", rule = "", sort = 350),
        Category(id = "cat-bank-charges", name = "Bank charges", group = "Admin & financial", kind = Type.EXPENSE, icon = "🏦", colour = "#90A4AE", rule = "By seats", sort = 360),
        Category(id = "cat-wire-gateway-fees", name = "Wire & gateway fees", group = "Admin & financial", kind = Type.EXPENSE, icon = "💱", colour = "#B0BEC5", rule = "", sort = 370),
        Category(id = "cat-fx-loss", name = "FX loss", group = "Admin & financial", kind = Type.EXPENSE, icon = "📉", colour = "#9E9E9E", rule = "", sort = 380),
        Category(id = "cat-taxes-government-fees", name = "Taxes & government fees", group = "Admin & financial", kind = Type.EXPENSE, icon = "🧾", colour = "#757575", rule = "By seats", sort = 390),
        Category(id = "cat-legal-professional", name = "Legal & professional", group = "Admin & financial", kind = Type.EXPENSE, icon = "⚖️", colour = "#607D8B", rule = "By seats", sort = 400),
        Category(id = "cat-accounting", name = "Accounting", group = "Admin & financial", kind = Type.EXPENSE, icon = "📊", colour = "#546E7A", rule = "By seats", sort = 410),
        Category(id = "cat-insurance", name = "Insurance", group = "Admin & financial", kind = Type.EXPENSE, icon = "🛡️", colour = "#78909C", rule = "By seats", sort = 420),
        Category(id = "cat-courier", name = "Courier", group = "Admin & financial", kind = Type.EXPENSE, icon = "📦", colour = "#8D6E63", rule = "", sort = 430),
        Category(id = "cat-printing-stationery", name = "Printing & stationery", group = "Admin & financial", kind = Type.EXPENSE, icon = "🖨️", colour = "#A1887F", rule = "By seats", sort = 440),
        Category(id = "cat-miscellaneous", name = "Miscellaneous", group = "Admin & financial", kind = Type.EXPENSE, icon = "➖", colour = "#90A4AE", rule = "", sort = 450),
        Category(id = "cat-client-payment", name = "Client payment", group = "Income", kind = Type.INCOME, icon = "💵", colour = "#2E7D32", rule = "", sort = 460),
        Category(id = "cat-commission-income", name = "Commission income", group = "Income", kind = Type.INCOME, icon = "💰", colour = "#00897B", rule = "", sort = 470),
        Category(id = "cat-other-income", name = "Other income", group = "Income", kind = Type.INCOME, icon = "➕", colour = "#90A4AE", rule = "", sort = 480),
    )

    val rules: List<Rule> = listOf(
        Rule(id = "rule-seats", name = "By seats", method = "Seats"),
        Rule(id = "rule-agents", name = "By agents", method = "Agents"),
        Rule(id = "rule-equal", name = "Equal split", method = "Equal"),
    )

    val accounts: List<Account> = listOf(
        Account(id = "acct-petty-cash", name = "Petty cash", kind = "Cash", icon = "\uD83D\uDCB5", colour = "#43A047"),
        Account(id = "acct-bank-main", name = "Bank \u2014 main", kind = "Bank", icon = "\uD83C\uDFE6", colour = "#1E88E5"),
        Account(id = "acct-jazzcash", name = "JazzCash", kind = "Mobile wallet", icon = "\uD83D\uDCF1", colour = "#7E57C2"),
    )

    val campaigns: List<Campaign> = listOf(
        Campaign(id = "camp-internal", name = "Internal / Company", code = "INT", kind = "Internal",
            icon = "\uD83C\uDFDB\uFE0F", colour = "#90A4AE"),
    )
}
