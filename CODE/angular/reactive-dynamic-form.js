export class RegistrationComponent implements OnInit {
  regForm: FormGroup;

  constructor(private fb: FormBuilder, private userService: UserService) {
    this.regForm = this.fb.group({
      username: ['', 
        [Validators.required], 
        [this.uniqueUsernameValidator()] // Async validator goes in the 3rd argument
      ],
      contactMethod: ['email'],
      phone: ['']
    });
  }

  ngOnInit() {
    this.setupDynamicValidation();
  }

  // ASYNC VALIDATOR: Factory function
  uniqueUsernameValidator(): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors | null> => {
      return this.userService.checkUsernameExists(control.value).pipe(
        map(exists => (exists ? { usernameTaken: true } : null)),
        catchError(() => of(null)) // Safety: if API fails, form isn't stuck
      );
    };
  }

  // DYNAMIC VALIDATION: Listening to changes
  setupDynamicValidation() {
    const phoneControl = this.regForm.get('phone');
    
    this.regForm.get('contactMethod')?.valueChanges.subscribe(method => {
      if (method === 'phone') {
        phoneControl?.setValidators([Validators.required, Validators.minLength(10)]);
      } else {
        phoneControl?.clearValidators();
      }
      phoneControl?.updateValueAndValidity(); // Mandatory to refresh UI
    });
  }
}