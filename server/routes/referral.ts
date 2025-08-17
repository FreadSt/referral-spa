import { RequestHandler } from 'express';
import { ReferralData } from '@shared/api';
import { v4 as uuidv4 } from 'uuid';

// In-memory storage for referral data (replace with database in production)
export const referralDataStore: Record<string, ReferralData> = {};
// In-memory storage for referred purchases
export const referredPurchases: Array<{
  referralCode: string;
  referredEmail: string;
  orderId?: string;
  status: string;
  timestamp: number;
}> = [];

export const generateReferralCode: RequestHandler = (req, res) => {
  const { userId } = req.body; // Assuming userId is sent in the request body

  if (!userId) {
    return res.status(400).json({ message: 'userId is required' });
  }

  const referralCode = uuidv4(); // Generate a unique code
  const purchaseTimestamp = Date.now();
  const status = 'pending'; // Initial status is pending

  const referralData: ReferralData = {
    userId,
    referralCode,
    purchaseTimestamp,
    status,
  };

  referralDataStore[referralCode] = referralData;

  console.log('Referral data stored:', referralDataStore);

  res.status(201).json({ referralCode });
};

export const getReferralData: RequestHandler = (req, res) => {
  const { userId } = req.params; // Assuming userId is passed as a URL parameter

  if (!userId) {
    return res.status(400).json({ message: 'userId is required' });
  }

  // Find referral data for the user (assuming one referral per user for simplicity)
  const userReferral = Object.values(referralDataStore).find(data => data.userId === userId);

  if (!userReferral) {
    return res.status(404).json({ message: 'Referral data not found for this user' });
  }

  res.status(200).json(userReferral);
};

// New endpoint: Get all referred users for a referrer (by referral code)
export const getReferredUsers: RequestHandler = (req, res) => {
  const { referralCode } = req.params;
  if (!referralCode) {
    return res.status(400).json({ message: 'referralCode is required' });
  }
  const referred = referredPurchases.filter(r => r.referralCode === referralCode);
  res.status(200).json(referred);
};
