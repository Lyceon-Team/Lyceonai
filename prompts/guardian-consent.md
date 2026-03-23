During signup, if user selects that they are under 13, they need guardian consent to complete profile creation. Write a plan but do not implement any code yet. Explain how this flow will exist in the current code logic, and what would need to be changed or added to achieve this.

If is_under_13, trigger parental consent flow.

- The child should provide Parent/Guardian Email
- Backend should store child_temp_id, guardian_email, consent_status = pending
- Guardian_email should get an email with link to approve child account
- Guardian verification page should link consent confirmation 
- I am the child's parent or legal guardian
- I am at least 18 years old
- Low friction verification includes 
  - Email + confirmation
  - Credit card verification ($0.50 temporary charge)
    Use stripe to verify
    - POST /create-verification-charge
      - amount = 50  // $0.50
      - currency = usd
      - capture_method = manual
    - if payment_success:
      - mark_parent_consent(child_id)
      - cancel_or_refund_payment()
    Do NOT store:
      - credit card number
      - CVV
      - expiration date
    Do store:
      - guardian_email
      - verification_method
      - transaction_id
      - timestamp
      - child_id
    ALWAYS void immediately after
- Once consent is verified, consent_status = approved
- parent_id = create_parent_account()
- child_account = create_child_account(parent_id), where parent gets control over the account
Note: if is_under_13 is false, and date_of_birth shows user <13, force guardian consent
COPPA requires parents to be able to:
* View child data
* Delete child data
* Revoke consent
If parent never gives consent, delete child_temp_record after 7–14 days.
The simple rule I am trying to ensure is if Age < 13
→ parent email
→ parent verifies they are 18+
→ consent stored
→ child account activated
