import React from 'react';

// Validation types
export type ValidationRule<T> = (value: T) => string | null;
export type ValidationResult = { isValid: boolean; errors: string[] };

// Common validation rules
export const validators = {
  required: (message = 'This field is required'): ValidationRule<any> => 
    (value) => (value === null || value === undefined || value === '') ? message : null,
  
  minLength: (min: number, message?: string): ValidationRule<string> => 
    (value) => value.length < min ? (message || `Minimum length is ${min} characters`) : null,
  
  maxLength: (max: number, message?: string): ValidationRule<string> => 
    (value) => value.length > max ? (message || `Maximum length is ${max} characters`) : null,
  
  email: (message = 'Invalid email address'): ValidationRule<string> => 
    (value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? message : null,
  
  url: (message = 'Invalid URL'): ValidationRule<string> => 
    (value) => {
      try {
        new URL(value);
        return null;
      } catch {
        return message;
      }
    },
  
  number: (message = 'Must be a number'): ValidationRule<any> => 
    (value) => isNaN(Number(value)) ? message : null,
  
  min: (min: number, message?: string): ValidationRule<number> => 
    (value) => value < min ? (message || `Minimum value is ${min}`) : null,
  
  max: (max: number, message?: string): ValidationRule<number> => 
    (value) => value > max ? (message || `Maximum value is ${max}`) : null,
  
  range: (min: number, max: number, message?: string): ValidationRule<number> => 
    (value) => value < min || value > max ? (message || `Value must be between ${min} and ${max}`) : null,
  
  pattern: (regex: RegExp, message = 'Invalid format'): ValidationRule<string> => 
    (value) => !regex.test(value) ? message : null,
  
  fileSize: (maxSizeMB: number, message?: string): ValidationRule<File> => 
    (file) => file.size > maxSizeMB * 1024 * 1024 ? (message || `File size must be less than ${maxSizeMB}MB`) : null,
  
  fileType: (allowedTypes: string[], message?: string): ValidationRule<File> => 
    (file) => !allowedTypes.includes(file.type) ? (message || `File type must be one of: ${allowedTypes.join(', ')}`) : null,
  
  audioFile: (message = 'Invalid audio file'): ValidationRule<File> => 
    (file) => !file.type.startsWith('audio/') ? message : null,
  
  imageFile: (message = 'Invalid image file'): ValidationRule<File> => 
    (file) => !file.type.startsWith('image/') ? message : null,
  
  hexColor: (message = 'Invalid color format'): ValidationRule<string> => 
    (value) => !/^#[0-9A-F]{6}$/i.test(value) ? message : null,
  
  unique: <T>(existingValues: T[], message = 'Value must be unique'): ValidationRule<T> => 
    (value) => existingValues.includes(value) ? message : null,
  
  custom: <T>(validator: (value: T) => boolean, message: string): ValidationRule<T> => 
    (value) => !validator(value) ? message : null
};

// Validation function
export function validate<T>(value: T, rules: ValidationRule<T>[]): ValidationResult {
  const errors: string[] = [];
  
  for (const rule of rules) {
    const error = rule(value);
    if (error) {
      errors.push(error);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Hook for form validation
export function useValidation<T>(initialValue: T, rules: ValidationRule<T>[]) {
  const [value, setValue] = React.useState<T>(initialValue);
  const [touched, setTouched] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  
  const validationResult = React.useMemo(() => validate(value, rules), [value, rules]);
  
  React.useEffect(() => {
    if (touched) {
      setErrors(validationResult.errors);
    }
  }, [validationResult, touched]);
  
  const handleChange = React.useCallback((newValue: T) => {
    setValue(newValue);
    if (touched) {
      setErrors(validate(newValue, rules).errors);
    }
  }, [touched, rules]);
  
  const handleBlur = React.useCallback(() => {
    setTouched(true);
    setErrors(validationResult.errors);
  }, [validationResult.errors]);
  
  const reset = React.useCallback(() => {
    setValue(initialValue);
    setTouched(false);
    setErrors([]);
  }, [initialValue]);
  
  return {
    value,
    errors,
    isValid: validationResult.isValid,
    touched,
    handleChange,
    handleBlur,
    reset,
    setValue
  };
}

// Specific validation schemas for the app
export const padValidation = {
  name: [
    validators.required('Pad name is required'),
    validators.minLength(1, 'Pad name cannot be empty'),
    validators.maxLength(50, 'Pad name must be 50 characters or less')
  ],
  
  volume: [
    validators.required('Volume is required'),
    validators.number('Volume must be a number'),
    validators.range(0, 1, 'Volume must be between 0 and 1')
  ],
  
  pitch: [
    validators.number('Pitch must be a number'),
    validators.range(-24, 24, 'Pitch must be between -24 and 24 semitones')
  ],
  
  startTime: [
    validators.number('Start time must be a number'),
    validators.min(0, 'Start time cannot be negative')
  ],
  
  endTime: [
    validators.number('End time must be a number'),
    validators.min(0, 'End time cannot be negative')
  ],
  
  fadeIn: [
    validators.number('Fade-in time must be a number'),
    validators.min(0, 'Fade-in time cannot be negative'),
    validators.max(10000, 'Fade-in time cannot exceed 10 seconds')
  ],
  
  fadeOut: [
    validators.number('Fade-out time must be a number'),
    validators.min(0, 'Fade-out time cannot be negative'),
    validators.max(10000, 'Fade-out time cannot exceed 10 seconds')
  ],
  
  audioFile: [
    validators.required('Audio file is required'),
    validators.audioFile('Please select a valid audio file'),
    validators.fileSize(50, 'Audio file must be less than 50MB')
  ],
  
  imageFile: [
    validators.imageFile('Please select a valid image file'),
    validators.fileSize(5, 'Image file must be less than 5MB')
  ]
};

export const bankValidation = {
  name: [
    validators.required('Bank name is required'),
    validators.minLength(1, 'Bank name cannot be empty'),
    validators.maxLength(100, 'Bank name must be 100 characters or less')
  ],
  
  color: [
    validators.required('Bank color is required'),
    validators.hexColor('Please select a valid color')
  ]
};

export const userValidation = {
  displayName: [
    validators.required('Display name is required'),
    validators.minLength(2, 'Display name must be at least 2 characters'),
    validators.maxLength(50, 'Display name must be 50 characters or less')
  ],
  
  email: [
    validators.required('Email is required'),
    validators.email('Please enter a valid email address')
  ],
  
  password: [
    validators.required('Password is required'),
    validators.minLength(8, 'Password must be at least 8 characters'),
    validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number')
  ]
};

// Sanitization functions
export const sanitizers = {
  trim: (value: string): string => value.trim(),
  
  toLowerCase: (value: string): string => value.toLowerCase(),
  
  toUpperCase: (value: string): string => value.toUpperCase(),
  
  removeSpecialChars: (value: string): string => value.replace(/[^a-zA-Z0-9\s]/g, ''),
  
  normalizeWhitespace: (value: string): string => value.replace(/\s+/g, ' '),
  
  escapeHtml: (value: string): string => {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  },
  
  unescapeHtml: (value: string): string => {
    const div = document.createElement('div');
    div.innerHTML = value;
    return div.textContent || '';
  },
  
  normalizeFileName: (value: string): string => 
    value.replace(/[^a-zA-Z0-9\s\-_\.]/g, '').replace(/\s+/g, '_'),
  
  normalizeUrl: (value: string): string => {
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      return `https://${value}`;
    }
    return value;
  }
};

// Combined validation and sanitization
export function validateAndSanitize<T>(
  value: T, 
  rules: ValidationRule<T>[], 
  sanitizers: ((value: T) => T)[] = []
): { isValid: boolean; errors: string[]; sanitizedValue: T } {
  const sanitizedValue = sanitizers.reduce((val, sanitizer) => sanitizer(val), value);
  const validation = validate(sanitizedValue, rules);
  
  return {
    isValid: validation.isValid,
    errors: validation.errors,
    sanitizedValue
  };
}
