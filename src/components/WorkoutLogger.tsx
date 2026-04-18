import React, { useState } from 'react';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { WorkoutIntensity, UserProfile } from '../types';
import { X, Loader2, Dumbbell, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import { GoogleGenAI } from '@google/genai';

interface WorkoutLoggerProps {
  profile: UserProfile;
  onClose: () => void;
  onLogged: () => void;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const workoutTypes = [
  'Walking', 'Running', 'Cycling', 'Gym', 'Swimming', 'Yoga', 'HIIT', 'Soccer', 'Basketball', 'Tennis', 'Other'
];

export default function WorkoutLogger({ profile, onClose, onLogged }: WorkoutLoggerProps) {
  const [type, setType] = useState('Gym');
  const [duration, setDuration] = useState('30');
  const [intensity, setIntensity] = useState<WorkoutIntensity>('moderate');
  const [weight, setWeight] = useState(profile.weight?.toString() || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculateAndLog = async () => {
    if (!duration || !weight) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const weightNum = parseFloat(weight);
      if (isNaN(weightNum)) throw new Error('Invalid weight');

      const prompt = `The user weighs ${weightNum}kg. They did ${type} for ${duration} minutes at ${intensity} intensity. Calculate exactly how many calories they burned. Reply with only a single number, nothing else.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ parts: [{ text: prompt }] }]
      });

      const resultText = response.text || '0';
      const caloriesBurned = parseInt(resultText.replace(/[^0-9]/g, '')) || 0;

      // Update weight in profile if changed
      if (Math.abs(weightNum - (profile.currentWeight || profile.weight)) > 0.1) {
        await updateDoc(doc(db, 'users', profile.userId), {
          weight: weightNum,
          currentWeight: weightNum,
          updatedAt: serverTimestamp()
        });
      }

      await addDoc(collection(db, 'users', profile.userId, 'workouts'), {
        type,
        duration: parseInt(duration),
        intensity,
        caloriesBurned,
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp()
      });

      onLogged();
      onClose();
    } catch (err: any) {
      console.error('Workout Log Error:', err);
      setError(err.message || 'Failed to calculate calories. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        className="w-full max-w-md"
      >
        <Card className="rounded-t-[32px] sm:rounded-[32px] border-[#E8E6E0] bg-white shadow-2xl overflow-hidden p-0">
          <CardHeader className="flex flex-row items-center justify-between p-8 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#5A6E4B]/10 flex items-center justify-center">
                <Dumbbell className="h-6 w-6 text-[#5A6E4B]" />
              </div>
              <CardTitle className="text-2xl font-serif font-bold text-[#2D2D2A]">Log Workout</CardTitle>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-[#F1F3EE]">
              <X className="h-6 w-6 text-[#8E8D8A]" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6 p-8 pt-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#8E8D8A]">Workout Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-12 rounded-xl border-[#E8E6E0] bg-[#F8F7F2]">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {workoutTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-[#8E8D8A]">Duration (min)</Label>
                <Input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="h-12 rounded-xl border-[#E8E6E0] bg-[#F8F7F2]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-[#8E8D8A]">Current Weight (kg)</Label>
                <Input
                  type="number"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="h-12 rounded-xl border-[#E8E6E0] bg-[#F8F7F2]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#8E8D8A]">Intensity</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['light', 'moderate', 'intense'] as WorkoutIntensity[]).map((i) => (
                  <Button
                    key={i}
                    variant={intensity === i ? 'default' : 'outline'}
                    onClick={() => setIntensity(i)}
                    className={`capitalize h-12 rounded-xl ${
                      intensity === i 
                        ? 'bg-[#5A6E4B] text-white' 
                        : 'border-[#E8E6E0] text-[#8E8D8A] hover:bg-[#F1F3EE]'
                    }`}
                  >
                    {i}
                  </Button>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 p-3 rounded-xl border border-red-100">{error}</p>
            )}

            <Button
              className="w-full h-14 bg-[#5A6E4B] text-lg font-bold rounded-2xl shadow-lg hover:bg-[#4A5E3B] transition-all disabled:opacity-50"
              onClick={calculateAndLog}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                  Gemini Calculating...
                </>
              ) : (
                <>
                  <Trophy className="mr-3 h-6 w-6" />
                  Log Workout
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
