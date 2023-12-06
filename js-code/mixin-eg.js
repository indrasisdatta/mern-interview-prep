
const ValidationMixin = {
	required() {
  	if (!this.fields) return false;
    return this.fields.every(f => !!f && f.length > 0);
  }
}

class User {
	constructor() {
  	this.fields = ['email', 'username', 'password'];
    Object.assign(this, ValidationMixin);
  }
}

const user = new User();
console.log('User required: ', user.required());
