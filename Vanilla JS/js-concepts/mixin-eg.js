/**
 * Mixins - class containing methods that can be used by other classes without inheriting
 */
const CustomMixin = {
  displayName() {
  	console.log('Name', this.name);
  }
}
class User {
  constructor(name) {
  	this.name = name;
  }
}
Object.assign(User.prototype, CustomMixin);
new User('User A').displayName();

/* Example of Validation Mixin */
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
