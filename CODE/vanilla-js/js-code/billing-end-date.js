/**
 * Get end date closest to nearest billing cycle
 * @param string startDate eg. 2024-03-04
 * @param number billingFrequency eg. 1 (bill every week)
 * @param number durationMonths eg. 2
 *
 * Eg 1. Customer subscribed for 2 months, billed every 1 week
 *  billingFrequency = 1, durationMonths = 2. 
 *  startDate = '2024-03-04'
 *  Expected output = 2024-04-29
 *
 * Eg 2. Customer subscribed for 6 months, billed every 2 weeks
 *  billingFrequency = 2, durationMonths = 6
 *  startDate = '2024-03-04'
 *   Expected output = 2024-09-02
 */
 function getBillingEndDate(startDate, billingFrequency, durationMonths) {
   let startTS = new Date(startDate).getTime();
   const durationEndTS = addDays(new Date(startDate), durationMonths*30);
   console.log(startTS, durationEndTS)
   let endDate = null;
   while (new Date(startDate).getTime() <= durationEndTS) {
     endDate = new Date(startDate);
       console.log('startDate', new Date(startDate))
      startDate = addDays(new Date(startDate), billingFrequency*7);
   }
   console.log('End date', endDate)
 }
 
 const addDays = (date, days) => {
   return date.setDate(date.getDate() + days);
 }
 
 getBillingEndDate('2024-03-04', 1, 2); // 2024-04-29
