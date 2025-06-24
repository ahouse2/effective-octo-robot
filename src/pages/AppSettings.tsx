import React, { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/components/SessionContextProvider";

const appSettingsFormSchema = z.object({
  enableNotifications: z.boolean(),
  automaticDataSync: z.boolean(),
});

type AppSettingsFormValues = z.infer<typeof appSettingsFormSchema>;

const AppSettings = () => {
  const { user, loading: sessionLoading } = useSession();
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<AppSettingsFormValues>({
    resolver: zodResolver(appSettingsFormSchema),
    defaultValues: {
      enableNotifications: true,
      automaticDataSync: true,
    },
  });

  useEffect(() => {
    const fetchSettings = async () => {
      if (!user) {
        setLoadingSettings(false);
        return;
      }

      setLoadingSettings(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('enable_notifications, automatic_data_sync')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found
        console.error("Error fetching app settings:", error);
        toast.error("Failed to load app settings.");
      } else if (data) {
        form.reset({
          enableNotifications: data.enable_notifications ?? true,
          automaticDataSync: data.automatic_data_sync ?? true,
        });
      }
      setLoadingSettings(false);
    };

    if (!sessionLoading) {
      fetchSettings();
    }
  }, [user, sessionLoading, form]);

  const onSubmit = async (values: AppSettingsFormValues) => {
    if (!user) {
      toast.error("You must be logged in to update settings.");
      return;
    }

    setIsSubmitting(true);
    const loadingToastId = toast.loading("Saving settings...");

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          enable_notifications: values.enableNotifications,
          automatic_data_sync: values.automaticDataSync,
        })
        .eq('id', user.id);

      if (error) {
        throw new Error("Failed to update settings: " + error.message);
      }

      toast.success("Settings updated successfully!");
    } catch (err: any) {
      console.error("App settings update error:", err);
      toast.error(err.message || "An unexpected error occurred during settings update.");
    } finally {
      setIsSubmitting(false);
      toast.dismiss(loadingToastId);
    }
  };

  if (sessionLoading || loadingSettings) {
    return (
      <Layout>
        <div className="container mx-auto py-8 text-center">
          <p className="text-lg text-gray-700 dark:text-gray-300">Loading settings...</p>
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
              <CardDescription>Please log in to view app settings.</CardDescription>
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
        <h1 className="text-4xl font-bold mb-8 text-center">App Settings</h1>

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
            <CardDescription>Manage application-wide preferences.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="enableNotifications"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Enable Notifications</FormLabel>
                        <FormDescription>
                          Receive in-app notifications for case updates and agent activities.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="automaticDataSync"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Automatic Data Sync</FormLabel>
                        <FormDescription>
                          Automatically synchronize case data in the background.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isSubmitting}
                        />
                      </FormControl>
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

export default AppSettings;