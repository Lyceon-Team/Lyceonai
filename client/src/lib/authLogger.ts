/**
 * Auth logging utility for consistent error/success handling
 */

type AuthResult = {
  success: boolean;
  message: string;
  data?: any;
  error?: any;
};

export function logAuthResult(prefix: string, resultOrError: any): AuthResult {
  const timestamp = new Date().toISOString();
  
  // Handle error objects
  if (resultOrError instanceof Error || resultOrError?.error) {
    const errorMsg = resultOrError.message || resultOrError.error?.message || 'Unknown error';
    console.error(`[${prefix}] ❌ ${errorMsg}`, { timestamp, error: resultOrError });
    return {
      success: false,
      message: errorMsg,
      error: resultOrError,
    };
  }
  
  // Handle success results
  if (resultOrError?.data || resultOrError?.user || resultOrError?.session) {
    const successMsg = resultOrError.message || 'Operation successful';
    console.log(`[${prefix}] ✅ ${successMsg}`, { timestamp, data: resultOrError });
    return {
      success: true,
      message: successMsg,
      data: resultOrError,
    };
  }
  
  // Handle plain messages
  if (typeof resultOrError === 'string') {
    console.log(`[${prefix}] ℹ️ ${resultOrError}`, { timestamp });
    return {
      success: true,
      message: resultOrError,
    };
  }
  
  // Default case
  console.log(`[${prefix}]`, { timestamp, result: resultOrError });
  return {
    success: true,
    message: 'Operation completed',
    data: resultOrError,
  };
}

export function logAuthStep(prefix: string, step: string, data?: any) {
  console.log(`[${prefix}] 🔄 ${step}`, data ? { data } : {});
}

export function logAuthWarning(prefix: string, warning: string, data?: any) {
  console.warn(`[${prefix}] ⚠️ ${warning}`, data ? { data } : {});
}
