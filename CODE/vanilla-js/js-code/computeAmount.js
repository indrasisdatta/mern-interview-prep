/**
 * Input:
 * computeAmount().hundreds(5).thousands(25).lacs(3).value()
 * Output: 500 + 25000 + 300000 = 325500
 */
 function calculator() {
    this.amount = 0;
    this.hundreds = function(input) {
      this.amount += input * 100;
      return this;
    };
    this.thousands = function(input) {
     this.amount += input * 1000;
     return this;
    };
     this.lacs = function(input) {
        this.amount += input * 100000;
        console.log('Lacs output: ', this)
        return this;
     },
     this.value = function() {
       return this.amount;
     }
     return this;
 }
 
 function computeAmount() {
 	return new calculator();
 }
 
 console.log(computeAmount().hundreds(5).thousands(25).lacs(3).value())
