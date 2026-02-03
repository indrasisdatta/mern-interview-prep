const TextInput = ({ label }) => <input type="text" placeholder={label} />;
const DropdownInput = ({ options }) => (
  <select>{options.map(opt => <option key={opt}>{opt}</option>)}</select>
);
const CheckboxInput = ({ label }) => <label><input type="checkbox" /> {label}</label>;

const InputFactory = ({ type, props }) => {
  // The Factory logic decides which component to "manufacture"
  switch (type) {
    case 'text':     return <TextInput {...props} />;
    case 'select':   return <DropdownInput {...props} />;
    case 'checkbox': return <CheckboxInput {...props} />;
    default:         return null;
  }
};

/* Component code */
const schema = [
  { id: 1, type: 'text', props: { label: 'Full Name' } },
  { id: 2, type: 'select', props: { options: ['Admin', 'Editor'] } }
];
function Form() {
  return (
    <form>
      {schema.map(field => (
        <InputFactory key={field.id} type={field.type} props={field.props} />
      ))}
    </form>
  );
}
/**
 * Note: for dynamic validation, no need to pass the validation rules as props as that could lead to props drilling
 * Use libraries like react-hooks-form and zod 
 */

// In your main form, you define the validation schema and wrap everything in a FormProvider.
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// 1. Define the "Master Rules"
const schema = z.object({
  username: z.string().min(3, "Too short!"),
  email: z.string().email("Invalid email"),
});

function MyForm() {
  const methods = useForm({
    resolver: zodResolver(schema), // Link the rules
  });

  const onSubmit = data => console.log(data);

  return (
    // 2. Broadcast the "methods" (validation, register, errors) to all children
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)}>
        
        {/* We just pass the NAME, not the whole schema */}
        <InputFactory name="username" type="text" label="User Name" />
        <InputFactory name="email" type="text" label="Email Address" />
        
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}

// The InputFactory uses useFormContext to grab the validation logic from the air. It doesn't need to receive the schema as a prop.
import { useFormContext } from 'react-hook-form';

const InputFactory = ({ name, type, label }) => {
  // 3. "Tune in" to the form context
  const { register, formState: { errors } } = useFormContext();

  // Pick the component (could be a separate mapping object)
  const isTextArea = type === 'textarea';
  const InputComponent = isTextArea ? 'textarea' : 'input';

  return (
    <div className="input-group">
      <label>{label}</label>
      
      {/* 4. Register this input with the central controller */}
      <InputComponent {...register(name)} type={type} />
      
      {/* 5. Display errors if the central controller says it's invalid */}
      {errors[name] && <p className="error">{errors[name].message}</p>}
    </div>
  );
};

/**
 * NOTE:
 * Standard HTML tags work great with register. 
 * But if you use a library like React-Select or MUI, the 
 *   "standard" registration doesn't work. 
 * For those, you use the Controller component from React Hook Form 
 *   inside your factory.
 */
import { Controller, useFormContext } from 'react-hook-form';
import Select from 'react-select'; // Third-party library example

// Inside your Factory's switch or map
case 'multi-select':
  return (
    <Controller
      name={name}
      control={control} // grabbed from useFormContext
      render={({ field }) => <Select {...field} options={options} isMulti />}
    />
  );