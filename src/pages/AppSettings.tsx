import React from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const AppSettings = () => {
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
            <div className="flex items-center justify-between">
              <Label htmlFor="notifications">Enable Notifications</Label>
              <Switch id="notifications" defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Label htmlFor="data-sync">Automatic Data Sync</Label>
              <Switch id="data-sync" defaultChecked />
            </div>
            <Separator />
            <p className="text-sm text-muted-foreground">
              More settings will be added here in the future.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default AppSettings;