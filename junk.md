Updated in the spec:

Added Change 10 (implemented ownership/security hardening).
Added Change 11 (your new user-spectrum request as draft).
Logged both in Decisions + Implementation Plan.
See:

docs/business-logic-change-spec.md (line 399)
docs/business-logic-change-spec.md (line 431)
To freeze scope properly, I need these clarifications:

For total spent, should we count only successful payments, and should we show both NGN and USD (or only one)?
For total delivery completed, which statuses count as completed: only DELIVERED_TO_RECIPIENT, or also PICKED_UP_COMPLETED?
For the monthly/frequency chart, do you want last 12 months by default?
For total shipments, should this be all-time created shipments, or only active/non-cancelled shipments?
For vendor storage, should customers save vendors as simple contacts first, or must each vendor map to a real SUPPLIER account user?
When customers add a new vendor, should internal staff see it immediately, or after approval/review?
For D2D public intake, should submission create a support ticket, a draft order, or both?
For public D2D submitters who choose “remain external,” what minimum identity do we require: name + phone + email?
For tracking status visibility, do you want a reduced customer-safe status map (public + authenticated customer both use same mapped statuses)?
For “total kg” in tracking, should we use summed actual weightKg from goods, or chargeable/billable weight?
For receipt upload, should users upload against invoiceId, orderId, or either?
Who can verify receipts and flip payment to successful: STAFF and SUPER_ADMIN, or SUPER_ADMIN only?




answer:
1. For total spent, should we count only successful payments, and should we show both NGN and USD (or only one)? We should show only successful payment and we show USD and option to switch between the 2 NGN and USD and the rates used should be the rates set by the super admin or the fallback official rates 

2. Total delivery completed. pickedup completed and delivered to recipient

3. last 3 months by default 

4. all shipments both active, none active and non-cancelled

5. vendors and suppliers are the same things

6. see it immediately 

7. both

8. yes or what is the standard 

9. what is more efficient? i have told you what i want you to do on both end

10. whatever the final weight was from the internal setup is what we want to show to users remember we also show them the volume or weight kg

11. i think we should have just one - order

12 super admin


Let me know if you have further questions



Implement Phase 2: vendor/supplier save & internal visibility flow
Implement Phase 3: public D2D intake (order + support ticket) + receipt upload/verification flow