# Candidate profile

`data/profile.json` is the local source of truth. It contains contact details, work authorization, preferences, answer style, confirmed reusable answers, and facts extracted from source documents.

Values from explicit user input have confidence 1. Resume-derived identity and contact values are treated as verified only when extraction returns a value. Generated prose is usable only at confidence 0.65 or higher and must remain grounded in stored facts. A missing value stays blank.

Sensitive fields include visa and sponsorship status, compensation expectations, demographic questions, veteran status, disability status, gender, race, ethnicity, and pronouns. Ask the user before filling them unless the exact answer is already saved. Checkboxes always remain for manual review.

The application engine has no submit operation. Its final state is `review`, and its last browser action only scrolls near the submit control.
