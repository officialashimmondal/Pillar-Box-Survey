import * as React from 'react';
import { Component, ErrorInfo, ReactNode, useState, useEffect } from 'react';
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  onSnapshot, 
  query, 
  where, 
  orderBy,
  getDocFromServer,
  doc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut, 
  User 
} from 'firebase/auth';
import { db, auth } from './firebase';
import { 
  ClipboardCheck, 
  LogOut, 
  LogIn, 
  CheckCircle2, 
  AlertCircle, 
  Wifi, 
  WifiOff, 
  Calendar, 
  MapPin, 
  Info,
  ChevronDown,
  User as UserIcon,
  RefreshCw
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

// --- Error Handling Spec ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Simple Error Wrapper ---
const ErrorBoundary = ({ children }: { children: ReactNode }) => {
  return <>{children}</>;
};

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---
const SURVEYOR_NAMES = [
  "Prosenjit Polley", "Priyabrata Das", "Sourav Ghosh", 
  "Prithwiraj Mal", "Raj Mandal", "Kinkar Baj", "Soham Mondal"
];

const CATEGORIES = ["ACPB", "FEEDER PILLAR", "LINK PILLAR"];
const PILLAR_TYPES = ["MODIFIED", "CONVENTIONAL"];
const PILLAR_SIZES = ["2WAY", "4WAY", "6WAY", "8WAY"];
const DOOR_CONDITIONS = ["FRONT", "BACK"];
const BASE_PLATE_CONDITIONS = ["OK", "BROKEN", "DAMAGED"];
const BLANK_OFF_CONDITIONS = ["OK", "SOIL RAISED UP", "DAMAGED"];
const LOCK_STATUS = ["YES", "NO"];
const DOOR_STATUS_OPTIONS = ["PROPERLY CLOSED", "PROPERLY NOT CLOSED"];

// --- Types ---
interface SurveyData {
  surveyorName: string;
  surveyDate: string;
  pillarBoxName: string;
  category: string;
  pillarType: string;
  pillarSize: string;
  doorCondition: string;
  basePlateCondition: string;
  blankOff: string;
  lock: string;
  doorStatus: string;
  hingeBroken: boolean;
  pbInclined: boolean;
  raisingRequired: boolean;
  garbageBlockage: boolean;
  pbAddress: string;
  findings: string;
}

const INITIAL_STATE: SurveyData = {
  surveyorName: '',
  surveyDate: new Date().toISOString().split('T')[0],
  pillarBoxName: '',
  category: '',
  pillarType: '',
  pillarSize: '',
  doorCondition: 'FRONT',
  basePlateCondition: 'OK',
  blankOff: 'OK',
  lock: 'YES',
  doorStatus: 'PROPERLY CLOSED',
  hingeBroken: false,
  pbInclined: false,
  raisingRequired: false,
  garbageBlockage: false,
  pbAddress: '',
  findings: '',
};

function SurveyApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [formData, setFormData] = useState<SurveyData>(INITIAL_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof SurveyData, string>>>({});

  // Auth & Connection Listeners
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Test Firestore connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.log("Firestore is in offline mode.");
        }
      }
    };
    testConnection();

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const validate = () => {
    const newErrors: Partial<Record<keyof SurveyData, string>> = {};
    if (!formData.surveyorName) newErrors.surveyorName = "Surveyor Name is required";
    if (!formData.surveyDate) newErrors.surveyDate = "Survey Date is required";
    if (!formData.pillarBoxName) newErrors.pillarBoxName = "Pillar Box Name/Number is required";
    if (!formData.category) newErrors.category = "Category is required";
    if (!formData.pillarType) newErrors.pillarType = "Pillar Type is required";
    if (!formData.pillarSize) newErrors.pillarSize = "Pillar Size is required";
    if (!formData.pbAddress) newErrors.pbAddress = "PB Address is required";
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    const path = 'surveys';
    try {
      await addDoc(collection(db, path), {
        ...formData,
        createdBy: user?.uid,
        createdAt: serverTimestamp(),
      });
      
      setShowSuccess(true);
      setFormData(INITIAL_STATE);
      setTimeout(() => setShowSuccess(false), 5000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F2FA] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#6750A4] border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F7F2FA] flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-[28px] p-8 shadow-lg text-center border border-[#CAC4D0]"
        >
          <div className="w-16 h-16 bg-[#EADDFF] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ClipboardCheck className="w-8 h-8 text-[#21005D]" />
          </div>
          <h1 className="text-3xl font-bold text-[#1C1B1F] mb-2">PB Survey Tool</h1>
          <p className="text-[#49454F] mb-8">Professional Field Technician Survey Application</p>
          
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-[#6750A4] text-white py-4 rounded-full font-medium hover:bg-[#4F378B] transition-colors shadow-md active:scale-95"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F2FA] pb-12">
      {/* Header */}
      <header className="bg-white border-b border-[#CAC4D0] sticky top-0 z-10 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-[#EADDFF] p-2 rounded-lg">
            <ClipboardCheck className="w-6 h-6 text-[#21005D]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#1C1B1F] leading-tight">PB Survey Tool</h1>
            <div className="flex items-center gap-2">
              {isOnline ? (
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-bold uppercase tracking-wider">
                  <Wifi className="w-3 h-3" /> Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-amber-600 font-bold uppercase tracking-wider">
                  <WifiOff className="w-3 h-3" /> Offline Mode
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 text-sm text-[#49454F]">
            <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-[#CAC4D0]" />
            <span className="font-medium">{user.displayName}</span>
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 text-[#49454F] hover:bg-[#EADDFF] rounded-full transition-colors"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 sm:p-6">
        {/* Success Message */}
        <AnimatePresence>
          {showSuccess && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 bg-[#D1E1FF] text-[#001D35] p-4 rounded-2xl flex items-center gap-3 border border-[#004A77]"
            >
              <CheckCircle2 className="w-6 h-6 text-[#0061A4]" />
              <span className="font-medium">Survey Data Uploaded Successfully</span>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section: Basic Info */}
          <section className="bg-white rounded-[28px] p-6 shadow-sm border border-[#CAC4D0]">
            <div className="flex items-center gap-2 mb-6 text-[#6750A4]">
              <UserIcon className="w-5 h-5" />
              <h2 className="text-xl font-bold">Surveyor Information</h2>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#49454F] ml-1">Surveyor Name *</label>
                <div className="relative">
                  <select
                    value={formData.surveyorName}
                    onChange={(e) => setFormData({ ...formData, surveyorName: e.target.value })}
                    className={cn(
                      "w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 appearance-none focus:border-[#6750A4] focus:ring-1 focus:ring-[#6750A4] outline-none transition-all",
                      errors.surveyorName && "border-red-500 bg-red-50"
                    )}
                  >
                    <option value="">Select Surveyor</option>
                    {SURVEYOR_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#49454F] pointer-events-none" />
                </div>
                {errors.surveyorName && <p className="text-xs text-red-500 ml-1">{errors.surveyorName}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-[#49454F] ml-1">PILLAR BOX CHECK DATE *</label>
                <div className="relative">
                  <input
                    type="date"
                    value={formData.surveyDate}
                    onChange={(e) => setFormData({ ...formData, surveyDate: e.target.value })}
                    className={cn(
                      "w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 focus:border-[#6750A4] focus:ring-1 focus:ring-[#6750A4] outline-none transition-all",
                      errors.surveyDate && "border-red-500 bg-red-50"
                    )}
                  />
                </div>
                {errors.surveyDate && <p className="text-xs text-red-500 ml-1">{errors.surveyDate}</p>}
              </div>
            </div>
          </section>

          {/* Section: Pillar Box Details */}
          <section className="bg-white rounded-[28px] p-6 shadow-sm border border-[#CAC4D0]">
            <div className="flex items-center gap-2 mb-6 text-[#6750A4]">
              <Info className="w-5 h-5" />
              <h2 className="text-xl font-bold">Pillar Box Details</h2>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#49454F] ml-1">PILLAR BOX NAME/NUMBER *</label>
                <input
                  type="text"
                  placeholder="Enter name or number"
                  value={formData.pillarBoxName}
                  onChange={(e) => setFormData({ ...formData, pillarBoxName: e.target.value })}
                  className={cn(
                    "w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 focus:border-[#6750A4] focus:ring-1 focus:ring-[#6750A4] outline-none transition-all",
                    errors.pillarBoxName && "border-red-500 bg-red-50"
                  )}
                />
                {errors.pillarBoxName && <p className="text-xs text-red-500 ml-1">{errors.pillarBoxName}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#49454F] ml-1">CATEGORY *</label>
                  <div className="relative">
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className={cn(
                        "w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 appearance-none focus:border-[#6750A4] focus:ring-1 focus:ring-[#6750A4] outline-none transition-all",
                        errors.category && "border-red-500 bg-red-50"
                      )}
                    >
                      <option value="">Select</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#49454F] pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#49454F] ml-1">PILLAR TYPE *</label>
                  <div className="relative">
                    <select
                      value={formData.pillarType}
                      onChange={(e) => setFormData({ ...formData, pillarType: e.target.value })}
                      className={cn(
                        "w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 appearance-none focus:border-[#6750A4] focus:ring-1 focus:ring-[#6750A4] outline-none transition-all",
                        errors.pillarType && "border-red-500 bg-red-50"
                      )}
                    >
                      <option value="">Select</option>
                      {PILLAR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#49454F] pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#49454F] ml-1">PILLAR SIZE *</label>
                  <div className="relative">
                    <select
                      value={formData.pillarSize}
                      onChange={(e) => setFormData({ ...formData, pillarSize: e.target.value })}
                      className={cn(
                        "w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 appearance-none focus:border-[#6750A4] focus:ring-1 focus:ring-[#6750A4] outline-none transition-all",
                        errors.pillarSize && "border-red-500 bg-red-50"
                      )}
                    >
                      <option value="">Select</option>
                      {PILLAR_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#49454F] pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section: Physical Inspection */}
          <section className="bg-white rounded-[28px] p-6 shadow-sm border border-[#CAC4D0]">
            <div className="flex items-center gap-2 mb-6 text-[#6750A4]">
              <ClipboardCheck className="w-5 h-5" />
              <h2 className="text-xl font-bold">Physical Inspection</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#49454F] ml-1">DOOR (FRONT/BACK)</label>
                <div className="relative">
                  <select
                    value={formData.doorCondition}
                    onChange={(e) => setFormData({ ...formData, doorCondition: e.target.value })}
                    className="w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 appearance-none focus:border-[#6750A4] outline-none transition-all"
                  >
                    {DOOR_CONDITIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#49454F] pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-[#49454F] ml-1">BASE PLATE CONDITION</label>
                <div className="relative">
                  <select
                    value={formData.basePlateCondition}
                    onChange={(e) => setFormData({ ...formData, basePlateCondition: e.target.value })}
                    className="w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 appearance-none focus:border-[#6750A4] outline-none transition-all"
                  >
                    {BASE_PLATE_CONDITIONS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#49454F] pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-[#49454F] ml-1">BLANK OFF</label>
                <div className="relative">
                  <select
                    value={formData.blankOff}
                    onChange={(e) => setFormData({ ...formData, blankOff: e.target.value })}
                    className="w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 appearance-none focus:border-[#6750A4] outline-none transition-all"
                  >
                    {BLANK_OFF_CONDITIONS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#49454F] pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-[#49454F] ml-1">LOCK</label>
                <div className="relative">
                  <select
                    value={formData.lock}
                    onChange={(e) => setFormData({ ...formData, lock: e.target.value })}
                    className="w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 appearance-none focus:border-[#6750A4] outline-none transition-all"
                  >
                    {LOCK_STATUS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#49454F] pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium text-[#49454F] ml-1">DOOR STATUS</label>
                <div className="relative">
                  <select
                    value={formData.doorStatus}
                    onChange={(e) => setFormData({ ...formData, doorStatus: e.target.value })}
                    className="w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 appearance-none focus:border-[#6750A4] outline-none transition-all"
                  >
                    {DOOR_STATUS_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#49454F] pointer-events-none" />
                </div>
              </div>
            </div>
          </section>

          {/* Section: Checklist */}
          <section className="bg-white rounded-[28px] p-6 shadow-sm border border-[#CAC4D0]">
            <div className="flex items-center gap-2 mb-6 text-[#6750A4]">
              <AlertCircle className="w-5 h-5" />
              <h2 className="text-xl font-bold">Yes/No Checklist</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { id: 'hingeBroken', label: 'Hinge Broken' },
                { id: 'pbInclined', label: 'PB Inclined' },
                { id: 'raisingRequired', label: 'Raising Required' },
                { id: 'garbageBlockage', label: 'Garbage/Blockage' },
              ].map((item) => (
                <div 
                  key={item.id}
                  onClick={() => setFormData({ ...formData, [item.id]: !formData[item.id as keyof SurveyData] })}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all active:scale-95",
                    formData[item.id as keyof SurveyData] 
                      ? "bg-[#EADDFF] border-[#6750A4] text-[#21005D]" 
                      : "bg-[#F7F2FA] border-[#79747E] text-[#49454F]"
                  )}
                >
                  <span className="font-medium">{item.label}</span>
                  <div className={cn(
                    "w-12 h-6 rounded-full relative transition-colors",
                    formData[item.id as keyof SurveyData] ? "bg-[#6750A4]" : "bg-[#79747E]"
                  )}>
                    <div className={cn(
                      "absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                      formData[item.id as keyof SurveyData] ? "left-7" : "left-1"
                    )} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section: Location & Notes */}
          <section className="bg-white rounded-[28px] p-6 shadow-sm border border-[#CAC4D0]">
            <div className="flex items-center gap-2 mb-6 text-[#6750A4]">
              <MapPin className="w-5 h-5" />
              <h2 className="text-xl font-bold">Location & Notes</h2>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#49454F] ml-1">PB Address *</label>
                <textarea
                  rows={3}
                  placeholder="Enter full address"
                  value={formData.pbAddress}
                  onChange={(e) => setFormData({ ...formData, pbAddress: e.target.value })}
                  className={cn(
                    "w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 focus:border-[#6750A4] focus:ring-1 focus:ring-[#6750A4] outline-none transition-all resize-none",
                    errors.pbAddress && "border-red-500 bg-red-50"
                  )}
                />
                {errors.pbAddress && <p className="text-xs text-red-500 ml-1">{errors.pbAddress}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-[#49454F] ml-1">Any Other Findings (Optional)</label>
                <textarea
                  rows={3}
                  placeholder="Enter additional observations"
                  value={formData.findings}
                  onChange={(e) => setFormData({ ...formData, findings: e.target.value })}
                  className="w-full bg-[#F7F2FA] border border-[#79747E] rounded-xl px-4 py-3 focus:border-[#6750A4] focus:ring-1 focus:ring-[#6750A4] outline-none transition-all resize-none"
                />
              </div>
            </div>
          </section>

          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              "w-full bg-[#6750A4] text-white py-4 rounded-full font-bold text-lg shadow-lg hover:bg-[#4F378B] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2",
              isSubmitting && "animate-pulse"
            )}
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Uploading...
              </>
            ) : (
              "Submit Survey"
            )}
          </button>
        </form>
      </main>

      {/* Footer Info */}
      <footer className="max-w-3xl mx-auto px-6 text-center text-[#49454F] text-xs">
        <p>© 2026 PB Survey Tool • Field Operations Division</p>
        <p className="mt-1">Data is automatically saved locally and synced when connection is available.</p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <SurveyApp />
    </ErrorBoundary>
  );
}
