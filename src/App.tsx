import * as React from 'react';
import { Component, ErrorInfo, ReactNode, useState, useEffect } from 'react';
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  onSnapshot, 
  query, 
  orderBy,
  getDocFromServer,
  doc,
  limit,
  updateDoc,
  deleteDoc,
  writeBatch,
  getDocs
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { 
  ClipboardCheck, 
  CheckCircle2, 
  AlertCircle, 
  Wifi, 
  WifiOff, 
  Calendar, 
  MapPin, 
  Info,
  ChevronDown,
  User as UserIcon,
  RefreshCw,
  Download,
  Pencil,
  Trash2,
  X,
  Check,
  ArrowLeft
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
      userId: auth.currentUser?.uid || 'anonymous',
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || false,
      isAnonymous: auth.currentUser?.isAnonymous || true,
      tenantId: auth.currentUser?.tenantId || null,
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

// --- Global Error Boundary ---
interface GlobalErrorBoundaryProps {
  children: React.ReactNode;
}

interface GlobalErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class GlobalErrorBoundary extends React.Component<GlobalErrorBoundaryProps, GlobalErrorBoundaryState> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) errorMessage = parsed.error;
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-[#F7F2FA] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-[28px] p-8 shadow-lg text-center border border-red-100">
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-[#1C1B1F] mb-2">Something went wrong</h2>
            <p className="text-[#49454F] mb-8">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-[#6750A4] text-white py-4 rounded-full font-medium hover:bg-[#4F378B] transition-colors shadow-md"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

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
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [formData, setFormData] = useState<SurveyData>(INITIAL_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof SurveyData, string>>>({});
  const [recentSurveys, setRecentSurveys] = useState<(SurveyData & { id: string, timestamp: Date })[]>([]);
  const [activeTab, setActiveTab] = useState<'form' | 'history'>('form');
  const [totalCount, setTotalCount] = useState(0);
  const [isSheetsConnected, setIsSheetsConnected] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Connection Listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check Google Sheets status
    fetch('/api/auth/google/status')
      .then(res => res.json())
      .then(data => setIsSheetsConnected(data.connected))
      .catch(err => console.error("Failed to check sheets status", err));

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        setIsSheetsConnected(true);
      }
    };
    window.addEventListener('message', handleMessage);

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
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Fetch Recent Surveys (Global for all users now)
  useEffect(() => {
    const q = query(
      collection(db, 'surveys'),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const surveys = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          timestamp: data.createdAt?.toDate?.() || new Date()
        };
      }) as (SurveyData & { id: string, timestamp: Date })[];
      setRecentSurveys(surveys);
      setTotalCount(snapshot.size); // This is just the size of the current snapshot (limit 20)
      // In a real app, we might want a separate count query, but for "Recent", this is fine.
    }, (error) => {
      console.error("Failed to fetch surveys:", error);
    });

    return () => unsubscribe();
  }, []);

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

  const downloadCSV = () => {
    if (recentSurveys.length === 0) return;

    // Define headers based on SurveyData interface
    const headers = [
      'Submission Date',
      'Surveyor Name',
      'Survey Date',
      'Pillar Box Name/Number',
      'Category',
      'Pillar Type',
      'Pillar Size',
      'Door Condition',
      'Base Plate Condition',
      'Blank Off',
      'Lock',
      'Door Status',
      'Hinge Broken',
      'PB Inclined',
      'Raising Required',
      'Garbage Blockage',
      'PB Address',
      'Findings'
    ];

    // Convert data to CSV rows
    const csvRows = [
      headers.join(','), // Header row
      ...recentSurveys.map(s => {
        return [
          new Date(s.timestamp).toLocaleString(),
          `"${s.surveyorName}"`,
          `"${s.surveyDate}"`,
          `"${s.pillarBoxName}"`,
          `"${s.category}"`,
          `"${s.pillarType}"`,
          `"${s.pillarSize}"`,
          `"${s.doorCondition}"`,
          `"${s.basePlateCondition}"`,
          `"${s.blankOff}"`,
          `"${s.lock}"`,
          `"${s.doorStatus}"`,
          s.hingeBroken ? 'YES' : 'NO',
          s.pbInclined ? 'YES' : 'NO',
          s.raisingRequired ? 'YES' : 'NO',
          s.garbageBlockage ? 'YES' : 'NO',
          `"${s.pbAddress.replace(/"/g, '""')}"`,
          `"${s.findings.replace(/"/g, '""')}"`
        ].join(',');
      })
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `pillar_box_surveys_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const handleConnectSheets = async () => {
    try {
      const res = await fetch('/api/auth/google/url');
      const { url } = await res.json();
      window.open(url, 'google_auth', 'width=600,height=700');
    } catch (error) {
      console.error("Failed to get auth URL", error);
    }
  };

  const handleDisconnectSheets = async () => {
    try {
      await fetch('/api/auth/google/logout', { method: 'POST' });
      setIsSheetsConnected(false);
    } catch (error) {
      console.error("Failed to logout", error);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setShowPreview(true);
  };

  const confirmSubmit = async () => {
    setIsSubmitting(true);
    const path = 'surveys';
    try {
      if (editingId) {
        // Update existing
        await updateDoc(doc(db, path, editingId), {
          ...formData,
          updatedAt: serverTimestamp(),
        });
      } else {
        // Create new
        await addDoc(collection(db, path), {
          ...formData,
          createdAt: serverTimestamp(),
        });
      }
      
      // Sync to Google Sheets if connected
      if (isSheetsConnected) {
        try {
          await fetch('/api/surveys/sync-sheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surveyData: formData }),
          });
        } catch (sheetError) {
          console.error("Failed to sync to Google Sheets", sheetError);
        }
      }

      setShowSuccess(true);
      setFormData(INITIAL_STATE);
      setEditingId(null);
      setShowPreview(false);
      setTimeout(() => setShowSuccess(false), 5000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (survey: SurveyData & { id: string, timestamp: Date }) => {
    const { id, timestamp, ...data } = survey;
    setFormData(data as SurveyData);
    setEditingId(id);
    setActiveTab('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this survey?')) return;
    try {
      await deleteDoc(doc(db, 'surveys', id));
    } catch (error) {
      console.error("Failed to delete survey:", error);
    }
  };

  const handleClearHistory = async () => {
    try {
      const q = query(collection(db, 'surveys'));
      const snapshot = await getDocs(q);
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      setShowClearConfirm(false);
    } catch (error) {
      console.error("Failed to clear history:", error);
    }
  };

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
        <div className="flex items-center gap-2">
          {/* Sheets connection removed as requested */}
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 sm:p-6">
        {/* Navigation Tabs */}
        <div className="flex bg-[#EADDFF] p-1 rounded-2xl mb-6 shadow-inner">
          <button
            onClick={() => setActiveTab('form')}
            className={cn(
              "flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
              activeTab === 'form' ? "bg-white text-[#21005D] shadow-sm" : "text-[#49454F] hover:bg-white/50"
            )}
          >
            <ClipboardCheck className="w-5 h-5" />
            New Survey
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              "flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
              activeTab === 'history' ? "bg-white text-[#21005D] shadow-sm" : "text-[#49454F] hover:bg-white/50"
            )}
          >
            <RefreshCw className="w-5 h-5" />
            History
          </button>
        </div>

        {activeTab === 'form' ? (
          <>
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
                    Processing...
                  </>
                ) : (
                  editingId ? "Update Survey" : "Submit Survey"
                )}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setFormData(INITIAL_STATE);
                  }}
                  className="w-full mt-4 text-[#6750A4] font-medium py-2 hover:bg-[#F7F2FA] rounded-full transition-colors"
                >
                  Cancel Edit
                </button>
              )}
            </form>
          </>
        ) : (
          <div className="space-y-6">
            <div className="flex items-end justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold text-[#1C1B1F]">Recent Submissions</h2>
                <p className="text-sm text-[#49454F]">Showing last {recentSurveys.length} surveys</p>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={downloadCSV}
                  disabled={recentSurveys.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-[#6750A4] text-white rounded-xl text-sm font-bold shadow-md hover:bg-[#4F378B] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Export CSV</span>
                </button>
                <button 
                  onClick={() => setShowClearConfirm(true)}
                  disabled={recentSurveys.length === 0}
                  className="p-2 text-[#BA1A1A] hover:bg-[#FFDAD6] rounded-xl transition-colors disabled:opacity-30"
                  title="Clear All History"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <div className="bg-white px-4 py-2 rounded-2xl border border-[#CAC4D0] shadow-sm">
                  <span className="text-[10px] font-bold text-[#49454F] uppercase tracking-wider block">Total Loaded</span>
                  <span className="text-2xl font-light text-[#1C1B1F]">{totalCount}</span>
                </div>
              </div>
            </div>

            {recentSurveys.length === 0 ? (
              <div className="bg-white rounded-[28px] p-12 text-center border border-[#CAC4D0]">
                <div className="w-16 h-16 bg-[#F7F2FA] rounded-full flex items-center justify-center mx-auto mb-4">
                  <ClipboardCheck className="w-8 h-8 text-[#49454F] opacity-20" />
                </div>
                <p className="text-[#49454F]">No surveys submitted yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {recentSurveys.map((survey) => (
                  <motion.div
                    key={survey.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-[24px] p-6 shadow-sm border border-[#CAC4D0] hover:border-[#6750A4] transition-all group"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-[#1C1B1F] text-xl group-hover:text-[#6750A4] transition-colors">{survey.pillarBoxName}</h3>
                        <div className="flex items-center gap-3 mt-1">
                          <p className="text-xs text-[#9e9e9e] flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> {survey.surveyDate}
                          </p>
                          <p className="text-xs text-[#9e9e9e] flex items-center gap-1">
                            <UserIcon className="w-3 h-3" /> {survey.surveyorName}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleEdit(survey)}
                          className="p-2 text-[#6750A4] hover:bg-[#EADDFF] rounded-full transition-colors"
                          title="Edit Survey"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(survey.id)}
                          className="p-2 text-[#BA1A1A] hover:bg-[#FFDAD6] rounded-full transition-colors"
                          title="Delete Survey"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <span className="bg-[#F7F2FA] text-[#49454F] text-[10px] font-bold px-3 py-1 rounded-full border border-[#CAC4D0] uppercase tracking-wider">
                          {survey.category}
                        </span>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                      <div className="bg-[#F7F2FA] p-3 rounded-xl border border-transparent group-hover:border-[#EADDFF] transition-colors">
                        <span className="text-[10px] text-[#9e9e9e] uppercase font-bold block mb-1">Lock</span>
                        <span className={cn("text-sm font-medium", survey.lock === 'YES' ? "text-emerald-600" : "text-red-600")}>
                          {survey.lock}
                        </span>
                      </div>
                      <div className="bg-[#F7F2FA] p-3 rounded-xl border border-transparent group-hover:border-[#EADDFF] transition-colors">
                        <span className="text-[10px] text-[#9e9e9e] uppercase font-bold block mb-1">Door</span>
                        <span className={cn("text-sm font-medium", survey.doorStatus === 'PROPERLY CLOSED' ? "text-emerald-600" : "text-red-600")}>
                          {survey.doorStatus === 'PROPERLY CLOSED' ? 'Closed' : 'Open'}
                        </span>
                      </div>
                      <div className="bg-[#F7F2FA] p-3 rounded-xl border border-transparent group-hover:border-[#EADDFF] transition-colors">
                        <span className="text-[10px] text-[#9e9e9e] uppercase font-bold block mb-1">Type</span>
                        <span className="text-sm font-medium text-[#1C1B1F]">{survey.pillarType}</span>
                      </div>
                      <div className="bg-[#F7F2FA] p-3 rounded-xl border border-transparent group-hover:border-[#EADDFF] transition-colors">
                        <span className="text-[10px] text-[#9e9e9e] uppercase font-bold block mb-1">Size</span>
                        <span className="text-sm font-medium text-[#1C1B1F]">{survey.pillarSize}</span>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-[#F7F2FA] flex items-center gap-2 text-xs text-[#9e9e9e]">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{survey.pbAddress}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer Info */}
      <footer className="max-w-3xl mx-auto px-6 text-center text-[#49454F] text-xs">
        <p>© 2026 PB Survey Tool • Field Operations Division</p>
        <p className="mt-1">Data is automatically saved locally and synced when connection is available.</p>
      </footer>

      {/* Preview Modal */}
      <AnimatePresence>
        {showPreview && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPreview(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-2xl max-h-[90vh] rounded-[32px] overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-[#CAC4D0] flex items-center justify-between bg-[#F7F2FA]">
                <h2 className="text-xl font-bold text-[#1C1B1F]">Review Survey Data</h2>
                <button onClick={() => setShowPreview(false)} className="p-2 hover:bg-[#EADDFF] rounded-full transition-colors">
                  <X className="w-6 h-6 text-[#49454F]" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
                  <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">Please review all information carefully before submitting. This will be recorded permanently.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-[#6750A4] uppercase tracking-widest">Basic Info</h3>
                    <div className="space-y-2">
                      <p className="text-sm"><span className="text-[#49454F] font-medium">Surveyor:</span> {formData.surveyorName}</p>
                      <p className="text-sm"><span className="text-[#49454F] font-medium">Date:</span> {formData.surveyDate}</p>
                      <p className="text-sm"><span className="text-[#49454F] font-medium">Pillar Box:</span> {formData.pillarBoxName}</p>
                      <p className="text-sm"><span className="text-[#49454F] font-medium">Category:</span> {formData.category}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-[#6750A4] uppercase tracking-widest">Pillar Details</h3>
                    <div className="space-y-2">
                      <p className="text-sm"><span className="text-[#49454F] font-medium">Type:</span> {formData.pillarType}</p>
                      <p className="text-sm"><span className="text-[#49454F] font-medium">Size:</span> {formData.pillarSize}</p>
                      <p className="text-sm"><span className="text-[#49454F] font-medium">Condition:</span> {formData.doorCondition}</p>
                      <p className="text-sm"><span className="text-[#49454F] font-medium">Base Plate:</span> {formData.basePlateCondition}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-[#6750A4] uppercase tracking-widest">Checklist Results</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Hinge Broken', value: formData.hingeBroken },
                      { label: 'PB Inclined', value: formData.pbInclined },
                      { label: 'Raising Required', value: formData.raisingRequired },
                      { label: 'Garbage Blockage', value: formData.garbageBlockage },
                    ].map(item => (
                      <div key={item.label} className="flex items-center gap-2 text-sm">
                        {item.value ? <Check className="w-4 h-4 text-emerald-600" /> : <X className="w-4 h-4 text-red-600" />}
                        <span className={item.value ? "text-emerald-700 font-medium" : "text-[#49454F]"}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-[#6750A4] uppercase tracking-widest">Address & Notes</h3>
                  <div className="bg-[#F7F2FA] p-4 rounded-2xl space-y-3">
                    <p className="text-sm italic text-[#49454F]">"{formData.pbAddress}"</p>
                    {formData.findings && (
                      <div className="pt-2 border-t border-[#CAC4D0]">
                        <p className="text-xs font-bold text-[#6750A4] uppercase mb-1">Findings</p>
                        <p className="text-sm text-[#49454F]">{formData.findings}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-[#CAC4D0] bg-[#F7F2FA] flex gap-3">
                <button 
                  onClick={() => setShowPreview(false)}
                  className="flex-1 px-6 py-4 rounded-full font-bold text-[#6750A4] border border-[#6750A4] hover:bg-white transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-5 h-5" />
                  Back
                </button>
                <button 
                  onClick={confirmSubmit}
                  disabled={isSubmitting}
                  className="flex-[2] px-6 py-4 rounded-full font-bold bg-[#6750A4] text-white shadow-lg hover:bg-[#4F378B] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? "Processing..." : "Confirm & Submit"}
                  <CheckCircle2 className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Clear History Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowClearConfirm(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Trash2 className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-[#1C1B1F] mb-2">Clear All History?</h2>
              <p className="text-[#49454F] mb-8">This action cannot be undone. All submitted surveys will be permanently deleted from the database.</p>
              
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleClearHistory}
                  className="w-full bg-[#BA1A1A] text-white py-4 rounded-full font-bold hover:bg-[#93000A] transition-colors shadow-md"
                >
                  Yes, Delete Everything
                </button>
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="w-full text-[#49454F] py-4 rounded-full font-bold hover:bg-[#F7F2FA] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <GlobalErrorBoundary>
      <SurveyApp />
    </GlobalErrorBoundary>
  );
}
