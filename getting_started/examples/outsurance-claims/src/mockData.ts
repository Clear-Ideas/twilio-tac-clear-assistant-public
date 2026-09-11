/**
 * Mock customer database for Clear Insurance demo.
 * Replace with a real CRM integration later — verifyCustomer.ts is the
 * only file that needs to change when that happens.
 */

export interface MockCustomer {
  policyNumber: string;
  fullName: string;
  phoneNumber: string;
  email: string;
}

export const MOCK_CUSTOMERS: MockCustomer[] = [
  {
    policyNumber: 'ABC123',
    fullName: 'Bruna Joe',
    phoneNumber: '',
    email: '',
  },
];

export function findCustomer(policyNumber: string): MockCustomer | undefined {
  const normalized = policyNumber.replace(/\s/g, '').toUpperCase();
  return MOCK_CUSTOMERS.find((c) => c.policyNumber.toUpperCase() === normalized);
}