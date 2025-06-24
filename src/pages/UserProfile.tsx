import React, { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/components/SessionContextProvider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const profileFormSchema = z.object({
  firstName: z.string().min(1, { message: "First name is required." }).max(50, { message: "First name too long." }),
  lastName: z.string().min(1, { message: "Last name is required." }).max(50, { message: "Last name too long." }),
  defaultAiModel: z.enum(["openai", "gemini"], {
    required_error: "Please select a default AI model.",
  }),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

const UserProfile = () => {
  const { user, loading: sessionLoading } = useSession();
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      defaultAiModel: "openai", // Default to OpenAI if not set
    },
  });

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) {
        setLoadingProfile(false);
        return;
      }

      setLoadingProfile(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('first_name, last_name, default_ai_model')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found
        console.error("Error fetching profile:", error);
        toast.error("Failed to load profile data.");
      } else if (data) {
        form.reset({
          firstName: data.first_name || "",
          lastName: data.last_name || "",
          defaultAiModel: (data.default_ai_model as "openai" | "gemini") || "openai",
        });
      }
      setLoadingProfile(false);
    };

    if (!sessionLoading) {
      fetchProfile();
    }
  }, [user, sessionLoading, form]);

  const onSubmit = async (values: ProfileFormValues) => {
    if (!user) {
      toast.error("You must be logged in to update your profile.");
      return;
    }

    setIsSubmitting(true);
    const loadingToastId = toast.loading("Updating profile...");

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: values.firstName,
          last_name: values.lastName,
          default_ai_model: values.defaultAiModel,
        })
        .eq('id', user.id);

      if (error) {
        throw new Error("Failed to update profile: " + error.message);
      }

      toast.success("Profile updated successfully!");
    } catch (err: any) {
      console.error("Profile update error:", err);
      toast.error(err.message || "An unexpected error occurred during profile update.");
    } finally {
      setIsSubmitting(false);
      toast.dismiss(loadingToastId);
    }
  };

  if (sessionLoading || loadingProfile) {
    return (
      <Layout>
        <div className="container mx-auto py-8 text-center">
          <p className="text-lg text-gray-700 dark:text-gray-300">Loading profile...</p>
        </div>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout>
        <div className="container mx-auto py-8">
          <Card className="max-w-md mx-auto">
            <CardHeader>
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>Please log in to view your profile.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => window.location.href = '/login'}>Go to Login</Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <h1 className="text-4xl font-bold mb-8 text-center">Your Profile</h1>

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Manage your personal details.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6">
              <Label className="text-sm font-medium">Email</Label>
              <p className="text-lg font-semibold text-foreground">{user.email}</p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Your first name" {...field} disabled={isSubmitting} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Your last name" {...field} disabled={isSubmitting} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="defaultAiModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default AI Model</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isSubmitting}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select your preferred AI model" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI (GPT-4o)</SelectItem>
                          <SelectItem value="gemini">Google Gemini</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        This will be the default AI model pre-selected when creating new cases.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save Changes"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default UserProfile;