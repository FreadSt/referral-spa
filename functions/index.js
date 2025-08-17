const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const onPaymentCreated = require('./onPaymentCreated');
const createCheckoutSession = require('./createCheckoutSession');
const refreshShipmentStatus = require('./refreshShipmentStatus');
const retryFailedEmails = require('./retryFailedEmails');
const onSubscriptionUpdated = require('./onSubscriptionUpdated');
const createNovaPoshtaShipment = require('./createNovaPoshtaShipment');
const checkShipmentStatus = require('./checkShipmentStatus');
const sendReferralLinks = require('./sendReferralLinks');
const runReferralCheck = require('./runReferralCheck');
const processReferralDue = require('./processReferralDue');

exports.onPaymentCreated = onPaymentCreated.onPaymentCreated;
exports.createCheckoutSession = createCheckoutSession.createCheckoutSession;
exports.refreshShipmentStatus = refreshShipmentStatus.refreshShipmentStatus;
exports.retryFailedEmails = retryFailedEmails.retryFailedEmails;
exports.onSubscriptionUpdated = onSubscriptionUpdated.onSubscriptionUpdated;
exports.createNovaPoshtaShipment = createNovaPoshtaShipment.createNovaPoshtaShipment;
exports.checkShipmentStatus = checkShipmentStatus.checkShipmentStatus;
exports.sendReferralLinks = sendReferralLinks.sendReferralLinks;
exports.runReferralCheck = runReferralCheck.runReferralCheck;
exports.processReferralDue = processReferralDue.processReferralDue;
