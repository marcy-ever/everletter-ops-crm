export interface SquarespacePreviewOrder {
  id: string; orderNumber: string; createdOn: string; customerName: string; customerEmail: string;
  shippingAddress: string; products: string[]; details: string[]; paymentState: string;
  addressLine1?: string; addressLine2?: string; city?: string; addressState?: string; postalCode?: string;
  fulfillmentStatus?: string; testMode?: boolean;
  recipientName: string; character: string; plan: string;
  existing: boolean; staged?: boolean; reviewStatus?: "Pending" | "Imported" | "Ignored"; warnings: string[];
  subscriberId?: string;
}

export interface SquarespaceImportInput {
  email: string; customerName: string; recipientName: string;
  addressLine1: string; addressLine2: string; city: string; addressState: string; postalCode: string;
  character: string; plan: string;
}

export interface SquarespacePreviewState {
  loading: boolean; failed: boolean; message: string; orders: SquarespacePreviewOrder[]; hasMore: boolean;
  lastCheckedAt?: string; pendingReviewCount?: number;
}

export interface SquarespaceOrderReviewState {
  loading: boolean; failed: boolean; message: string;
  reviews: Array<{ id: number; order: SquarespacePreviewOrder; createdAt: string }>;
}
