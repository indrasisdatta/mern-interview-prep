/**
 * Get end date closest to nearest billing cycle
 * @param string startDate eg. 2024-03-04
 * @param number billingFrequency eg. 1 (bill every week)
 * @param number durationMonths eg. 2
 *
 * Eg 1. Customer subscribed for 2 months, billed every 1 week
 *  billingFrequency = 1, durationMonths = 2.
 *  Expected output = 2024-04-29
 *
 * Eg 2. Customer subscribed for 6 months, billed every 2 weeks
 *  billingFrequency = 2, durationMonths = 6.
 *   Expected output = 2024-09-02
 */
 function getBillingEndDate(startDate, billingFrequency) {
 
 }
